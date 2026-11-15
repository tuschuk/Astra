/**
 * Tests for editing and deleting finished workouts (B14 / LOG-9), on real SQLite through the
 * real store, synced against the in-memory fake server and read back by a second device.
 *
 * The step's definition of done is the first test: deleting the workout that holds a PR
 * removes it and promotes the next best set — on the phone, on the server, and on another
 * device. The rest pin LOG-9's "editing corrects all affected PRs" (down, up, removed), the
 * exact outbox lines that make a lowering get past the server's keep-best rule, the
 * same-transaction guarantee, and the refusals.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { outboxSize } from '@/sync/outbox';
import { pullChanges } from '@/sync/pull';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createPreparedDb, steadyOptions } from '@/test-utils/loggerTestKit';
import { OTHER_USER_ID, USER_ID } from '@/test-utils/workoutFixtures';

import { startActiveWorkout, type SetInput } from './activeWorkout';
import { deleteWorkout, openWorkoutForEdit } from './editWorkout';
import { exerciseSessions, listPastWorkouts } from './history';
import * as prs from './prs';
import { currentPrs, personalRecordId } from './prs';

const SQUAT = libraryExerciseId('squat');
const BENCH = libraryExerciseId('bench_press');
const FIVE_RM = personalRecordId(USER_ID, SQUAT, 'repMax', 5);

const kg = (reps: number, weight: number, extra: Partial<SetInput> = {}): SetInput => ({
  reps,
  weight: { value: weight, unit: 'kg' },
  ...extra,
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Logs and finishes one workout on 2026-11-`day`; returns its id and its set ids per exercise. */
async function finishWorkout(
  db: SqlDriver,
  day: number,
  plan: [exerciseId: string, sets: SetInput[]][],
  userId = USER_ID,
): Promise<{ workoutId: string; sets: Record<string, string[]> }> {
  const store = await startActiveWorkout(db, userId, steadyOptions(`2026-11-${String(day).padStart(2, '0')}T09:00:00.000Z`));
  const sets: Record<string, string[]> = {};
  for (const [exerciseId, inputs] of plan) {
    const entry = await store.addExercise(exerciseId);
    for (const input of inputs) (sets[exerciseId] ??= []).push((await store.logSet(entry.id, input)).id);
  }
  await store.finish();
  return { workoutId: store.getSnapshot().workout.id, sets };
}

/** The stored record books of an exercise as [label, kg, source set] — on the phone. */
async function books(db: SqlDriver, exerciseId = SQUAT) {
  return (await currentPrs(db, USER_ID, exerciseId)).map((r) => [
    r.kind === 'repMax' ? `${r.reps}RM` : r.kind,
    r.value_kg,
    r.source_set_id,
  ]);
}

/** The same, from the fake server's table. */
function serverBooks(server: FakeServer, exerciseId = SQUAT) {
  return [...server.tables.personal_records.values()]
    .filter((r) => r.exercise_id === exerciseId)
    .map((r) => [r.kind === 'repMax' ? `${r.reps}RM` : r.kind, r.value_kg, r.source_set_id])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/** The personal-record outbox lines, in queue order, as [row id, op]. */
async function recordLines(db: SqlDriver) {
  const rows = await db.getAllAsync<{ row_id: string; op: string }>(
    "select row_id, op from outbox where tbl = 'personal_records' order by id",
  );
  return rows.map((r) => [r.row_id, r.op]);
}

/** A second phone of the same lifter that has downloaded everything. */
async function secondDevice(server: FakeServer): Promise<SqlDriver> {
  const other = await createPreparedDb();
  await pullChanges(other, server, USER_ID);
  return other;
}

describe('deleteWorkout — the step definition of done', () => {
  it('deleting the workout that holds a PR removes it and promotes the next best set, everywhere', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    const b = await finishWorkout(db, 11, [[SQUAT, [kg(5, 90)]]]);
    await pushOutbox(db, server);
    const other = await secondDevice(server);
    expect(await books(other)).toContainEqual(['5RM', 100, a.sets[SQUAT][0]]);

    await deleteWorkout(db, USER_ID, a.workoutId, '2026-11-12T09:00:00.000Z');

    // On the phone, straight away: the 5RM book now holds B's set.
    expect(await books(db)).toContainEqual(['5RM', 90, b.sets[SQUAT][0]]);
    expect(await books(db)).not.toContainEqual(expect.arrayContaining([a.sets[SQUAT][0]]));
    // Queued as delete-then-upload for the demoted book (keep-best would refuse a lowered update).
    expect(await recordLines(db)).toContainEqual([FIVE_RM, 'delete']);
    const lines = await recordLines(db);
    expect(lines.findIndex((l) => l[0] === FIVE_RM && l[1] === 'delete')).toBeLessThan(
      lines.findIndex((l) => l[0] === FIVE_RM && l[1] === 'upsert'),
    );

    // On the server, after a sync: workout A is gone and the book holds B's set.
    const result = await pushOutbox(db, server);
    expect(result.deleted.workouts).toBe(1);
    expect(server.tables.workouts.has(a.workoutId)).toBe(false);
    expect(serverBooks(server)).toContainEqual(['5RM', 90, b.sets[SQUAT][0]]);
    expect(await outboxSize(db)).toBe(0);

    // On the second phone, after its next download: A is gone, the promoted book arrived.
    const pulled = await pullChanges(other, server, USER_ID);
    expect(pulled.tombstones).toBeGreaterThan(0);
    expect((await listPastWorkouts(other, USER_ID)).map((w) => w.workout.id)).toEqual([b.workoutId]);
    expect(await books(other)).toContainEqual(['5RM', 90, b.sets[SQUAT][0]]);
    expect(await books(other)).toEqual(await books(db));
  });

  it('removes a book nothing else qualifies for, on the phone, the server and another phone', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(3, 120)]]]);
    await finishWorkout(db, 11, [[SQUAT, [kg(5, 90)]]]);
    await pushOutbox(db, server);
    const other = await secondDevice(server);
    const threeRm = personalRecordId(USER_ID, SQUAT, 'repMax', 3);

    await deleteWorkout(db, USER_ID, a.workoutId);
    expect((await books(db)).map((b) => b[0])).not.toContain('3RM');
    await pushOutbox(db, server);
    expect(server.tables.personal_records.has(threeRm)).toBe(false);
    await pullChanges(other, server, USER_ID);
    expect((await books(other)).map((b) => b[0])).not.toContain('3RM');
  });

  it('history readers stop showing a deleted workout', async () => {
    const db = await createPreparedDb();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    const b = await finishWorkout(db, 11, [[SQUAT, [kg(5, 90)]]]);
    await deleteWorkout(db, USER_ID, a.workoutId);
    expect((await listPastWorkouts(db, USER_ID)).map((w) => w.workout.id)).toEqual([b.workoutId]);
    expect((await exerciseSessions(db, USER_ID, SQUAT)).map((s) => s.workoutId)).toEqual([b.workoutId]);
  });

  it('a workout that never reached the server is deleted without the server ever hearing of it', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    await deleteWorkout(db, USER_ID, a.workoutId);
    await pushOutbox(db, server);
    // Its stale upload lines found no rows and were retired; the delete was a harmless no-op.
    expect(server.upsertCalls.flatMap((c) => c.ids)).not.toContain(a.workoutId);
    expect(server.tables.workouts.size).toBe(0);
    expect(server.tables.personal_records.size).toBe(0);
    expect(await outboxSize(db)).toBe(0);
  });

  it('refuses a workout in progress and another user’s workout, deleting nothing', async () => {
    const db = await createPreparedDb();
    const theirs = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]], OTHER_USER_ID);
    await expect(deleteWorkout(db, USER_ID, theirs.workoutId)).rejects.toThrow(/no longer on this phone/);
    const draft = await startActiveWorkout(db, USER_ID, steadyOptions());
    await expect(deleteWorkout(db, USER_ID, draft.getSnapshot().workout.id)).rejects.toThrow(/in progress/);
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 2 });
  });
});

describe('openWorkoutForEdit — editing corrects every affected PR (LOG-9)', () => {
  it('editing the record-holding set down demotes the book to the next best, locally and on the server', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    const b = await finishWorkout(db, 11, [[SQUAT, [kg(5, 90)]]]);
    await pushOutbox(db, server);

    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    if (!store) throw new Error('expected an edit store');
    await store.updateSet(a.sets[SQUAT][0], kg(5, 60));

    expect(await books(db)).toContainEqual(['5RM', 90, b.sets[SQUAT][0]]);
    expect(await recordLines(db)).toEqual(
      expect.arrayContaining([
        [FIVE_RM, 'delete'],
        [FIVE_RM, 'upsert'],
      ]),
    );
    await pushOutbox(db, server);
    // Not blocked by the keep-best mirror: it was a delete then an insert, never a lowered update.
    expect(serverBooks(server)).toContainEqual(['5RM', 90, b.sets[SQUAT][0]]);
    expect(server.tables.sets.get(a.sets[SQUAT][0])?.weight_kg).toBe(60);
    const other = await secondDevice(server);
    expect(await books(other)).toEqual(await books(db));
  });

  it('editing a set up raises the book with a plain upload (no delete line)', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    await pushOutbox(db, server);

    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    await store!.updateSet(a.sets[SQUAT][0], kg(5, 110));

    expect(await books(db)).toContainEqual(['5RM', 110, a.sets[SQUAT][0]]);
    expect((await recordLines(db)).filter((l) => l[1] === 'delete')).toEqual([]);
    await pushOutbox(db, server);
    expect(serverBooks(server)).toContainEqual(['5RM', 110, a.sets[SQUAT][0]]);
  });

  it('a raise never clobbers a higher record another phone already uploaded (keep-best still guards it)', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    await pushOutbox(db, server);
    // Another phone's better 5RM (120) is on the server, not yet downloaded here.
    const stored = server.tables.personal_records.get(FIVE_RM)!;
    const { updated_at: _stamp, ...rest } = stored;
    server.seed('personal_records', [{ ...rest, value_kg: 120 }]);

    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    await store!.updateSet(a.sets[SQUAT][0], kg(5, 105));
    await pushOutbox(db, server);
    expect(server.tables.personal_records.get(FIVE_RM)?.value_kg).toBe(120);
  });

  it('removing the only 5-rep set removes that book on the phone, the server and another phone', async () => {
    const db = await createPreparedDb();
    const server = new FakeServer();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100), kg(3, 110)]]]);
    await pushOutbox(db, server);
    const other = await secondDevice(server);

    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    await store!.removeSet(a.sets[SQUAT][0]);

    expect((await books(db)).map((b) => b[0])).not.toContain('5RM');
    await pushOutbox(db, server);
    expect(server.tables.personal_records.has(FIVE_RM)).toBe(false);
    expect(server.tables.sets.has(a.sets[SQUAT][0])).toBe(false);
    await pullChanges(other, server, USER_ID);
    expect((await books(other)).map((b) => b[0])).not.toContain('5RM');
    // The other phone dropped the removed set too (tree reconciliation), and renumbered the rest.
    expect(await other.getAllAsync('select id, position from sets')).toEqual([{ id: a.sets[SQUAT][1], position: 0 }]);
  });

  it('removing a whole exercise recomputes its books and queues one delete for the slot', async () => {
    const db = await createPreparedDb();
    const a = await finishWorkout(db, 10, [
      [SQUAT, [kg(5, 100)]],
      [BENCH, [kg(5, 80)]],
    ]);
    await db.runAsync('delete from outbox');
    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    const squatEntry = store!.getSnapshot().entries[0];
    await store!.removeExercise(squatEntry.id);

    expect(await books(db)).toEqual([]);
    expect(await books(db, BENCH)).not.toEqual([]);
    const lines = await db.getAllAsync<{ tbl: string; op: string }>('select tbl, op from outbox order by id');
    expect(lines.filter((l) => l.tbl === 'workout_exercises' && l.op === 'delete')).toHaveLength(1);
    expect(lines.filter((l) => l.tbl === 'sets' && l.op === 'delete')).toHaveLength(0); // the server cascades
    expect(lines).toContainEqual({ tbl: 'workouts', op: 'upsert' }); // touch-the-root
  });

  it('a title or note edit is queued with its workout and touches no record', async () => {
    const db = await createPreparedDb();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    await db.runAsync('delete from outbox');
    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    await store!.setTitle('Heavy day');
    await store!.setNotes('Edited later.');
    expect(await db.getFirstAsync('select title, notes from workouts')).toEqual({ title: 'Heavy day', notes: 'Edited later.' });
    expect(await db.getAllAsync('select distinct tbl, op from outbox')).toEqual([{ tbl: 'workouts', op: 'upsert' }]);
  });

  it('an over-limit edit is refused before anything is saved (the logger’s limits.ts checks)', async () => {
    const db = await createPreparedDb();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    await db.runAsync('delete from outbox');
    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    await expect(store!.updateSet(a.sets[SQUAT][0], kg(5, 100, { rpe: 11 }))).rejects.toThrow(RangeError);
    await expect(store!.setNotes('x'.repeat(2001))).rejects.toThrow(RangeError);
    expect(await outboxSize(db)).toBe(0);
    expect(await db.getFirstAsync('select rpe from sets')).toEqual({ rpe: null });
  });

  it('a recompute that fails rolls the whole edit back — never an edit saved with stale records', async () => {
    const db = await createPreparedDb();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    await db.runAsync('delete from outbox');
    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    jest.spyOn(prs, 'recomputeRecords').mockRejectedValueOnce(new Error('disk full'));

    await expect(store!.updateSet(a.sets[SQUAT][0], kg(5, 60))).rejects.toThrow('disk full');
    expect(await db.getFirstAsync('select weight_kg from sets')).toEqual({ weight_kg: 100 });
    expect(await outboxSize(db)).toBe(0);
    expect(await books(db)).toContainEqual(['5RM', 100, a.sets[SQUAT][0]]);
  });

  it('opens only this user’s finished workouts', async () => {
    const db = await createPreparedDb();
    const theirs = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]], OTHER_USER_ID);
    expect(await openWorkoutForEdit(db, USER_ID, theirs.workoutId)).toBeNull();
    const draft = await startActiveWorkout(db, USER_ID, steadyOptions());
    expect(await openWorkoutForEdit(db, USER_ID, draft.getSnapshot().workout.id)).toBeNull();
    expect(await openWorkoutForEdit(db, USER_ID, 'missing')).toBeNull();
  });

  it('finish is refused; discard deletes the workout, after which the store refuses late changes', async () => {
    const db = await createPreparedDb();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    await expect(store!.finish()).rejects.toThrow(/already finished/);
    await store!.discard();
    expect(store!.getStatus()).toBe('discarded');
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 0 });
    // An autosave flushing as the screen closes must not re-create the workout.
    await expect(store!.setTitle('late')).rejects.toThrow(/discarded/);
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 0 });
  });

  it('an edit store whose workout was deleted underneath it refuses to write it back', async () => {
    const db = await createPreparedDb();
    const a = await finishWorkout(db, 10, [[SQUAT, [kg(5, 100)]]]);
    const store = await openWorkoutForEdit(db, USER_ID, a.workoutId, steadyOptions('2026-11-12T09:00:00.000Z'));
    await deleteWorkout(db, USER_ID, a.workoutId);
    await expect(store!.setTitle('ghost')).rejects.toThrow(/no longer on this phone/);
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 0 });
  });
});
