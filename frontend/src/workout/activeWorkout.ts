/**
 * The workout you are logging right now — the "active workout" — as the app holds it.
 *
 * What it is: a workout row, its exercises in order, and each exercise's sets in order. Screens
 * (from B09) read it and call its operations: add an exercise, log a set, repeat the last set,
 * fix or remove a set, reorder or remove an exercise, finish, or throw the whole thing away.
 *
 * The rule that makes it survive a killed app (NFR-3): every operation is saved to the phone's
 * SQLite database FIRST, in one all-or-nothing transaction, and only then is the in-memory copy
 * rebuilt — by reading the workout back from SQLite. Memory is just a cache of the file. So if
 * the phone dies, runs out of battery or the app is swiped away at any moment, reopening the app
 * and calling `loadActiveWorkout` rebuilds exactly what the user last saw: nothing more, nothing
 * less.
 *
 * Sync: while the workout is in progress it lives only on the phone (written through the DAO's
 * draft path, never queued for upload). `finish` stamps the end time and queues the whole
 * workout for upload in a single transaction — the server only ever sees finished workouts.
 * See docs/feature_plans/active-workout-store.md for why.
 *
 * Every value is checked against the server's rules (`assertValidSetFields` in the shared
 * training-math module) before it is saved, so a set the server would refuse can never reach
 * the upload queue and block it.
 *
 * No React here: `subscribe` + `getSnapshot` are exactly what React's `useSyncExternalStore`
 * needs, so a screen can watch the store without this file knowing about screens.
 */
import {
  assertValidSetFields,
  lbToKg,
  roundRpeForStorage,
  roundWeightKgForStorage,
  type WeightUnit,
} from '@training-math';

import {
  deleteDraftRowsTx,
  fromSqlRow,
  TABLE_COLUMNS,
  writeDraftRowsTx,
  writeLocalTree,
  type SetRow,
  type WorkoutExerciseRow,
  type WorkoutRow,
} from '@/db/dao';
import { placeholders, type SqlDriver, type SqlExecutor } from '@/db/driver';
import { newUuid } from '@/lib/ids';

/** One exercise in the active workout, with its sets ordered by position. */
export interface ActiveEntry extends WorkoutExerciseRow {
  sets: SetRow[];
}

/** Everything the active workout holds: the workout row and its exercises ordered by position. */
export interface ActiveWorkoutSnapshot {
  workout: WorkoutRow;
  entries: ActiveEntry[];
}

/**
 * What the lifter typed for one set. Every field is optional (a timed plank has no reps; a
 * bodyweight set has no weight). `weight` is in whatever unit the lifter entered it in — the
 * store converts it to kilograms for saving.
 */
export interface SetInput {
  reps?: number | null;
  weight?: { value: number; unit: WeightUnit } | null;
  rpe?: number | null;
  isWarmup?: boolean;
  /** Segment of a drop set: the top set leaves this empty, the drops are 1, 2, … */
  dropSetPosition?: number | null;
  durationSeconds?: number | null;
}

/** Where the active workout is in its life. Only an `active` workout can be changed. */
export type ActiveWorkoutStatus = 'active' | 'finished' | 'discarded';

/** Things a test (or a future caller) can swap in. */
export interface ActiveWorkoutOptions {
  /** The current time as ISO-8601 text. Defaults to the device clock. */
  clock?: () => string;
  /** Makes a new row id. Defaults to a random v4 UUID (src/lib/ids.ts). */
  mintId?: () => string;
}

/** The active workout and every operation on it (see the file comment). */
export interface ActiveWorkoutStore {
  /** The current state. The same object is returned until something changes. */
  getSnapshot(): ActiveWorkoutSnapshot;
  /** Calls `listener` after every change; returns a function that stops it. */
  subscribe(listener: () => void): () => void;
  /** `active` until `finish` or `discard`; after that every change is refused. */
  getStatus(): ActiveWorkoutStatus;
  /** Adds an exercise (from the library or the user's own) at the end. Returns its new entry. */
  addExercise(exerciseId: string): Promise<ActiveEntry>;
  /** Removes an exercise and all its sets; the exercises after it move up. */
  removeExercise(entryId: string): Promise<void>;
  /** Moves an exercise to `newPosition` (0 = first); the others shift to make room. */
  reorderExercise(entryId: string, newPosition: number): Promise<void>;
  /** Logs a new set at the end of an exercise. Returns the saved set. */
  logSet(entryId: string, input: SetInput): Promise<SetRow>;
  /** Replaces what a set says (fixing a typo); its place in the list is kept. */
  updateSet(setId: string, input: SetInput): Promise<SetRow>;
  /** Removes a set; the sets after it move up. */
  removeSet(setId: string): Promise<void>;
  /** Logs a copy of the exercise's last set — the one-tap "same again" (NFR-2). */
  repeatLastSet(entryId: string): Promise<SetRow>;
  /** Ends the workout and hands it to sync. Returns the finished workout row. */
  finish(): Promise<WorkoutRow>;
  /** Deletes the in-progress workout from the phone entirely (never uploaded). */
  discard(): Promise<void>;
}

/** The device clock as ISO-8601 text. */
function systemClock(): string {
  return new Date().toISOString();
}

/** Reads one table's rows with a `where` clause, in the app's row shape. */
async function selectRows<T extends 'workouts' | 'workout_exercises' | 'sets'>(
  db: SqlExecutor,
  tbl: T,
  where: string,
  params: readonly (string | number)[],
) {
  const columns = (TABLE_COLUMNS[tbl] as readonly string[]).join(', ');
  const raw = await db.getAllAsync<Record<string, unknown>>(`select ${columns} from ${tbl} where ${where}`, params);
  return raw.map((r) => fromSqlRow(tbl, r));
}

/**
 * Reads one workout and everything in it from SQLite, ordered as the lifter sees it. Returns
 * null if the workout isn't there or belongs to someone else (the device file can still hold a
 * previous account's rows).
 */
async function readTree(db: SqlExecutor, userId: string, workoutId: string): Promise<ActiveWorkoutSnapshot | null> {
  const [workout] = await selectRows(db, 'workouts', 'id = ? and user_id = ?', [workoutId, userId]);
  if (!workout) return null;
  const entries = await selectRows(db, 'workout_exercises', 'workout_id = ? order by position, id', [workoutId]);
  const sets =
    entries.length === 0
      ? []
      : await selectRows(
          db,
          'sets',
          `workout_exercise_id in (${placeholders(entries.length)}) order by position, id`,
          entries.map((e) => e.id),
        );
  return {
    workout,
    entries: entries.map((e) => ({ ...e, sets: sets.filter((s) => s.workout_exercise_id === e.id) })),
  };
}

/** The user's newest unfinished workout's id, or null if every workout is finished. */
async function findActiveWorkoutId(db: SqlExecutor, userId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'select id from workouts where user_id = ? and ended_at is null order by started_at desc, id desc limit 1',
    [userId],
  );
  return row?.id ?? null;
}

/**
 * Turns what the lifter typed into the stored set columns: weight converted to kg and rounded
 * to the server column's 2 decimals, RPE rounded to its 1 decimal, then every value checked
 * against the server's rules. Throws a `RangeError` (before anything is saved) if one fails.
 */
function setColumns(input: SetInput, position: number) {
  const weightKg =
    input.weight == null
      ? null
      : roundWeightKgForStorage(input.weight.unit === 'lb' ? lbToKg(input.weight.value) : input.weight.value);
  const rpe = input.rpe == null ? null : roundRpeForStorage(input.rpe);
  const columns = {
    position,
    reps: input.reps ?? null,
    weight_kg: weightKg,
    rpe,
    is_warmup: input.isWarmup ?? false,
    drop_set_position: input.dropSetPosition ?? null,
    duration_seconds: input.durationSeconds ?? null,
  };
  assertValidSetFields({
    position,
    reps: columns.reps,
    weightKg: columns.weight_kg,
    rpe: columns.rpe,
    dropSetPosition: columns.drop_set_position,
    durationSeconds: columns.duration_seconds,
  });
  return columns;
}

/**
 * Starts a blank workout for `userId` (LOG-1's "start an empty workout") and returns its store.
 * The workout is saved to the phone immediately, public by default, with no title yet.
 *
 * Refuses (throws) if this user already has an unfinished workout: the screen must decide
 * whether to resume it (`loadActiveWorkout`) or throw it away (`discard`) — the store never
 * quietly creates a second active workout.
 */
export async function startActiveWorkout(
  db: SqlDriver,
  userId: string,
  options: ActiveWorkoutOptions = {},
): Promise<ActiveWorkoutStore> {
  const clock = options.clock ?? systemClock;
  const mintId = options.mintId ?? newUuid;
  const now = clock();
  const workout: WorkoutRow = {
    id: mintId(),
    user_id: userId,
    title: null,
    notes: null,
    started_at: now,
    ended_at: null,
    visibility: 'public',
    created_at: now,
    updated_at: now,
  };
  await db.withTransactionAsync(async (tx) => {
    // Checked inside the transaction so two quick starts can't both pass.
    if (await findActiveWorkoutId(tx, userId)) {
      throw new Error('A workout is already in progress; resume or discard it before starting another');
    }
    await writeDraftRowsTx(tx, 'workouts', [workout], now);
  });
  const snapshot = await readTree(db, userId, workout.id);
  if (!snapshot) throw new Error('The new workout could not be read back from the device');
  return createStore(db, userId, snapshot, clock, mintId);
}

/**
 * Finds `userId`'s unfinished workout on the phone and rebuilds its store — what the app does on
 * launch to pick up where the lifter left off, even after the app was killed. Returns null when
 * there is no workout in progress.
 *
 * If more than one unfinished workout exists (not possible through this store), the newest is
 * returned and the others are left untouched — never silently deleted.
 */
export async function loadActiveWorkout(
  db: SqlDriver,
  userId: string,
  options: ActiveWorkoutOptions = {},
): Promise<ActiveWorkoutStore | null> {
  const id = await findActiveWorkoutId(db, userId);
  if (!id) return null;
  const snapshot = await readTree(db, userId, id);
  if (!snapshot) return null;
  return createStore(db, userId, snapshot, options.clock ?? systemClock, options.mintId ?? newUuid);
}

/** Builds the store object around a snapshot already read from SQLite. */
function createStore(
  db: SqlDriver,
  userId: string,
  initial: ActiveWorkoutSnapshot,
  clock: () => string,
  mintId: () => string,
): ActiveWorkoutStore {
  const workoutId = initial.workout.id;
  let snapshot = initial;
  let status: ActiveWorkoutStatus = 'active';
  const listeners = new Set<() => void>();
  // Operations run one at a time, in call order, so two quick taps can't both read the same
  // "next position" and collide.
  let tail: Promise<unknown> = Promise.resolve();

  /** Tells every subscriber (a screen, from B09) that the snapshot changed. */
  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  /** Re-reads the workout from SQLite and publishes it as the new snapshot. */
  async function refresh(): Promise<void> {
    const next = await readTree(db, userId, workoutId);
    if (!next) throw new Error('The active workout is no longer on the device');
    snapshot = next;
    notify();
  }

  /**
   * Runs one operation in turn: refuses if the workout is no longer active, otherwise runs
   * `work` (which saves to SQLite) and then rebuilds the snapshot from SQLite. If `work` throws,
   * its transaction has rolled back and the snapshot is left as it was.
   *
   * `pick` turns `work`'s result (usually a new row's id) into what the caller gets back, read
   * from the rebuilt snapshot — so callers receive exactly what SQLite holds. `reread: false` is
   * only for `discard`, after which there is nothing left to read.
   */
  function mutate<T, R = T>(
    work: () => Promise<T>,
    { reread = true, pick }: { reread?: boolean; pick?: (value: T) => R } = {},
  ): Promise<R> {
    const run = async (): Promise<R> => {
      if (status !== 'active') throw new Error(`This workout is ${status} and can no longer be changed`);
      const value = await work();
      if (reread) await refresh();
      else notify();
      return pick ? pick(value) : (value as unknown as R);
    };
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  }

  /** Finds an exercise of THIS workout by id; throws for an id from anywhere else. */
  function entryById(entryId: string): ActiveEntry {
    const entry = snapshot.entries.find((e) => e.id === entryId);
    if (!entry) throw new Error(`No exercise ${entryId} in this workout`);
    return entry;
  }

  /** Finds a set of THIS workout by id, with the exercise it belongs to; throws otherwise. */
  function setById(setId: string): { entry: ActiveEntry; set: SetRow } {
    for (const entry of snapshot.entries) {
      const set = entry.sets.find((s) => s.id === setId);
      if (set) return { entry, set };
    }
    throw new Error(`No set ${setId} in this workout`);
  }

  /**
   * Re-numbers exercises 0, 1, 2, … in the given order, saving only those whose number changed,
   * so positions always stay a gap-free 0…n-1 after a remove or a move.
   */
  async function renumberEntriesTx(tx: SqlExecutor, ordered: readonly ActiveEntry[], now: string): Promise<void> {
    const changed = ordered
      .map(({ sets: _nested, ...entry }, position) => ({ ...entry, position }))
      .filter((entry, i) => entry.position !== ordered[i].position);
    await writeDraftRowsTx(tx, 'workout_exercises', changed, now);
  }

  /** The same gap-free re-numbering for one exercise's sets. */
  async function renumberSetsTx(tx: SqlExecutor, ordered: readonly SetRow[], now: string): Promise<void> {
    const changed = ordered
      .map((set, position) => ({ ...set, position }))
      .filter((set, i) => set.position !== ordered[i].position);
    await writeDraftRowsTx(tx, 'sets', changed, now);
  }

  /** Saves a new set at the end of `entry`. */
  async function appendSet(entry: ActiveEntry, columns: ReturnType<typeof setColumns>): Promise<SetRow> {
    const now = clock();
    const set: SetRow = { id: mintId(), workout_exercise_id: entry.id, ...columns, created_at: now, updated_at: now };
    await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, 'sets', [set], now));
    return set;
  }

  /** The saved copy of a set (used after `refresh`), so callers get exactly what SQLite holds. */
  function savedSet(setId: string): SetRow {
    return setById(setId).set;
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getStatus: () => status,

    addExercise: (exerciseId) =>
      mutate(async () => {
        const now = clock();
        const entry: WorkoutExerciseRow = {
          id: mintId(),
          workout_id: workoutId,
          exercise_id: exerciseId,
          position: snapshot.entries.length,
          notes: null,
          superset_group: null,
          created_at: now,
          updated_at: now,
        };
        await db.withTransactionAsync(async (tx) => {
          // The phone has no foreign key to exercises, but the server does: an unknown id (or
          // someone else's custom exercise) would be refused at upload and block the queue.
          const exercise = await tx.getFirstAsync<{ id: string }>(
            'select id from exercises where id = ? and (owner_id is null or owner_id = ?)',
            [exerciseId, userId],
          );
          if (!exercise) throw new Error(`Exercise ${exerciseId} is not in this user's library`);
          await writeDraftRowsTx(tx, 'workout_exercises', [entry], now);
        });
        return entry.id;
      }, { pick: entryById }),

    removeExercise: (entryId) =>
      mutate(async () => {
        const entry = entryById(entryId);
        const rest = snapshot.entries.filter((e) => e.id !== entry.id);
        const now = clock();
        await db.withTransactionAsync(async (tx) => {
          await deleteDraftRowsTx(tx, 'workout_exercises', [entry.id]);
          await renumberEntriesTx(tx, rest, now);
        });
      }),

    reorderExercise: (entryId, newPosition) =>
      mutate(async () => {
        const entry = entryById(entryId);
        const last = snapshot.entries.length - 1;
        if (!Number.isInteger(newPosition) || newPosition < 0 || newPosition > last) {
          throw new RangeError(`newPosition must be a whole number from 0 to ${last}, got ${newPosition}`);
        }
        const order = snapshot.entries.filter((e) => e.id !== entry.id);
        order.splice(newPosition, 0, entry);
        const now = clock();
        await db.withTransactionAsync((tx) => renumberEntriesTx(tx, order, now));
      }),

    logSet: (entryId, input) =>
      mutate(async () => {
        const entry = entryById(entryId);
        return (await appendSet(entry, setColumns(input, entry.sets.length))).id;
      }, { pick: savedSet }),

    updateSet: (setId, input) =>
      mutate(async () => {
        const { set } = setById(setId);
        const now = clock();
        const updated: SetRow = { ...set, ...setColumns(input, set.position), updated_at: now };
        await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, 'sets', [updated], now));
        return set.id;
      }, { pick: savedSet }),

    removeSet: (setId) =>
      mutate(async () => {
        const { entry, set } = setById(setId);
        const rest = entry.sets.filter((s) => s.id !== set.id);
        const now = clock();
        await db.withTransactionAsync(async (tx) => {
          await deleteDraftRowsTx(tx, 'sets', [set.id]);
          await renumberSetsTx(tx, rest, now);
        });
      }),

    repeatLastSet: (entryId) =>
      mutate(async () => {
        const entry = entryById(entryId);
        const previous = entry.sets[entry.sets.length - 1];
        if (!previous) throw new Error('This exercise has no set to repeat yet');
        // The previous set's values were checked when it was saved; only the position is new.
        const columns = {
          position: entry.sets.length,
          reps: previous.reps,
          weight_kg: previous.weight_kg,
          rpe: previous.rpe,
          is_warmup: previous.is_warmup,
          drop_set_position: previous.drop_set_position,
          duration_seconds: previous.duration_seconds,
        };
        assertValidSetFields({ position: columns.position });
        return (await appendSet(entry, columns)).id;
      }, { pick: savedSet }),

    finish: () =>
      mutate(async () => {
        const now = clock();
        // The server requires ended_at >= started_at; a device clock that jumped backwards must
        // not turn into an upload the server refuses forever, so the end is never before the start.
        const endedAt = Date.parse(now) < Date.parse(snapshot.workout.started_at) ? snapshot.workout.started_at : now;
        const workout: WorkoutRow = { ...snapshot.workout, ended_at: endedAt };
        await writeLocalTree(
          db,
          {
            workouts: [workout],
            workout_exercises: snapshot.entries.map(({ sets: _nested, ...entry }) => entry),
            sets: snapshot.entries.flatMap((e) => e.sets),
          },
          { now },
        );
        status = 'finished';
      }, { pick: () => snapshot.workout }),

    discard: () =>
      mutate(
        async () => {
          // Deleting the workout removes its entries and sets with it (the foreign keys cascade).
          await db.withTransactionAsync((tx) => deleteDraftRowsTx(tx, 'workouts', [workoutId]));
          status = 'discarded';
        },
        { reread: false },
      ),
  };
}
