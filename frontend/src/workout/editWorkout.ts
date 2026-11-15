/**
 * Editing and deleting a FINISHED workout (LOG-9, B14) — and keeping personal records right
 * when history changes.
 *
 * Editing reuses the logger: `openWorkoutForEdit` hands back the same `ActiveWorkoutStore` the
 * logger uses (add / remove / move exercises, log / fix / remove sets, notes, title …), built
 * with the EDIT policy below instead of the draft one. So every check the logger makes (the
 * server's limits on reps, weight, RPE, note lengths) and every bit of bookkeeping (gap-free
 * numbering, superset relinking) applies to edits too, from the one implementation.
 *
 * What the edit policy does differently from the logger's draft policy:
 *   - every change is saved AND queued for upload straight away (the workout is already on the
 *     server), with the workout re-stamped so other devices re-download it;
 *   - removed sets and exercises are queued as deletions;
 *   - and, in the SAME transaction as each change, the personal records of every exercise the
 *     change touched are recomputed from the remaining history (`recomputeRecords`) — raised,
 *     lowered, or removed as the data now says. One transaction means a killed app can never
 *     leave an edit saved with its records stale.
 * There is no Save button: each change is saved as it is made, like the logger. "Done" on the
 * edit screen is just navigation.
 *
 * Deleting (`deleteWorkout`) is one transaction too: the workout, its exercises and sets go,
 * the records of its exercises are recomputed from what remains (the next best set takes over
 * a deleted record — the step's definition of done), and one deletion is queued for the server,
 * whose foreign keys remove the rest.
 */
import {
  deleteLocalRowsTx,
  notifyLocalWrite,
  writeLocalRowsTx,
  type SetRow,
  type WorkoutExerciseRow,
} from '@/db/dao';
import { placeholders, type SqlDriver, type SqlExecutor } from '@/db/driver';

import {
  createWorkoutStore,
  readWorkoutTree,
  type ActiveWorkoutOptions,
  type ActiveWorkoutStore,
  type WritePolicy,
} from './activeWorkout';
import { recomputeRecords, saveRecomputedRecordsTx } from './prs';

/** The tables an edit or delete can change; the sync engine is told about all of them. */
const EDITED_TABLES = ['workouts', 'workout_exercises', 'sets', 'personal_records'] as const;

/**
 * Throws unless `workoutId` is a finished workout of `userId` on this phone. Run at the start of
 * every edit transaction: a workout deleted meanwhile (on this phone, or by another device's
 * deletion arriving in a download) must never be re-created by a late edit.
 */
async function assertEditableTx(tx: SqlExecutor, userId: string, workoutId: string): Promise<void> {
  const row = await tx.getFirstAsync<{ ended_at: string | null }>(
    'select ended_at from workouts where id = ? and user_id = ?',
    [workoutId, userId],
  );
  if (!row) throw new Error('This workout is no longer on this phone');
  if (row.ended_at == null) throw new Error('This workout is still in progress; edit it in the logger');
}

/** The exercises (by library / custom exercise id) of the given slots, as stored right now. */
async function exercisesOfEntries(tx: SqlExecutor, entryIds: readonly string[]): Promise<string[]> {
  if (entryIds.length === 0) return [];
  const rows = await tx.getAllAsync<{ exercise_id: string | null }>(
    `select distinct exercise_id from workout_exercises where id in (${placeholders(entryIds.length)})`,
    entryIds,
  );
  return rows.map((r) => r.exercise_id).filter((id): id is string => id != null);
}

/** The exercises of the given sets, as stored right now. */
async function exercisesOfSets(tx: SqlExecutor, setIds: readonly string[]): Promise<string[]> {
  if (setIds.length === 0) return [];
  const rows = await tx.getAllAsync<{ exercise_id: string | null }>(
    `select distinct e.exercise_id from sets s join workout_exercises e on e.id = s.workout_exercise_id
     where s.id in (${placeholders(setIds.length)})`,
    setIds,
  );
  return rows.map((r) => r.exercise_id).filter((id): id is string => id != null);
}

/**
 * The edit policy (see the file comment) for finished workout `workoutId` of `userId`.
 *
 * How it knows which records to recompute: while an operation's transaction runs, each save or
 * removal notes the exercises it touches — looked up BEFORE a removal, since afterwards the rows
 * are gone. When the operation's work is done, still inside the transaction, those exercises'
 * records are recomputed and saved. Operations of one store run one at a time (the store's
 * queue), so one set of notes per policy is enough.
 *
 * `finish` refuses (an edited workout is already saved). `discard` deletes the workout — that
 * is what the edit screen's "Delete workout" calls, so the store itself then refuses any late
 * change (an autosaving note box flushing as the screen closes cannot re-create it).
 */
export function editPolicy(db: SqlDriver, userId: string, workoutId: string): WritePolicy {
  let touched: Set<string> | null = null;
  let stamp: string | null = null;

  /** Notes exercises touched by the running operation. */
  function touch(exerciseIds: readonly string[], now: string): void {
    if (!touched) throw new Error('Edit writes must run inside the policy’s transaction');
    for (const id of exerciseIds) touched.add(id);
    stamp = now;
  }

  return {
    async transaction(work) {
      await db.withTransactionAsync(async (tx) => {
        touched = new Set();
        stamp = null;
        try {
          await assertEditableTx(tx, userId, workoutId);
          await work(tx);
          if (stamp && touched.size > 0) {
            await saveRecomputedRecordsTx(tx, await recomputeRecords(tx, userId, touched, stamp), stamp);
          }
        } finally {
          touched = null;
        }
      });
      notifyLocalWrite(db, EDITED_TABLES);
    },

    async writeRowsTx(tx, tbl, rows, now) {
      if (rows.length === 0) return;
      if (tbl === 'workout_exercises') {
        touch(
          (rows as readonly WorkoutExerciseRow[]).map((r) => r.exercise_id).filter((id): id is string => id != null),
          now,
        );
      } else if (tbl === 'sets') {
        touch(await exercisesOfEntries(tx, [...new Set((rows as readonly SetRow[]).map((s) => s.workout_exercise_id))]), now);
      }
      await writeLocalRowsTx(tx, tbl, rows, now);
    },

    async deleteRowsTx(tx, tbl, ids, now) {
      if (ids.length === 0) return;
      touch(tbl === 'sets' ? await exercisesOfSets(tx, ids) : await exercisesOfEntries(tx, ids), now);
      await deleteLocalRowsTx(tx, tbl, ids, now);
    },

    finish() {
      return Promise.reject(new Error('A saved workout is already finished; its edits are saved as they are made'));
    },

    discard: () => deleteWorkout(db, userId, workoutId),
  };
}

/**
 * Opens finished workout `workoutId` of `userId` for editing: a store over it whose every
 * operation saves, queues and recomputes records as described in the file comment. Returns
 * null when the workout isn't on this phone, isn't this user's, or isn't finished (a workout
 * in progress is edited in the logger).
 *
 * The store is NOT the session's active workout (that slot is for the logger's draft only):
 * the edit screen owns it, and starting a new workout while editing an old one is fine.
 */
export async function openWorkoutForEdit(
  db: SqlDriver,
  userId: string,
  workoutId: string,
  options: ActiveWorkoutOptions = {},
): Promise<ActiveWorkoutStore | null> {
  const snapshot = await readWorkoutTree(db, userId, workoutId);
  if (!snapshot || snapshot.workout.ended_at == null) return null;
  return createWorkoutStore(db, userId, snapshot, options, editPolicy(db, userId, workoutId));
}

/**
 * Deletes finished workout `workoutId` of `userId` — from the phone now, and from the server at
 * the next sync — in ONE transaction:
 *   1. note which exercises it held;
 *   2. delete it (the phone's foreign keys take its exercises and sets) and queue one deletion
 *      for the server (whose foreign keys take the same, plus the records citing those sets);
 *   3. recompute those exercises' records from the remaining history: a record this workout
 *      held moves to the next best set, or disappears if nothing else qualifies.
 * Then the sync engine is told, so it uploads soon.
 *
 * Refuses (throws, deleting nothing) for a workout that isn't this user's, isn't on the phone,
 * or is still in progress — that one is thrown away with the logger's Discard instead.
 */
export async function deleteWorkout(
  db: SqlDriver,
  userId: string,
  workoutId: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await db.withTransactionAsync(async (tx) => {
    await assertEditableTx(tx, userId, workoutId);
    const exercises = await tx.getAllAsync<{ exercise_id: string }>(
      'select distinct exercise_id from workout_exercises where workout_id = ? and exercise_id is not null',
      [workoutId],
    );
    await deleteLocalRowsTx(tx, 'workouts', [workoutId], now);
    const changes = await recomputeRecords(
      tx,
      userId,
      exercises.map((e) => e.exercise_id),
      now,
    );
    await saveRecomputedRecordsTx(tx, changes, now);
  });
  notifyLocalWrite(db, EDITED_TABLES);
}
