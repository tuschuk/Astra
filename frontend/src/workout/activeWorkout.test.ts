/**
 * Tests for the active-workout store, on real SQLite (Node's built-in engine).
 *
 * The two headline proofs of build step B08:
 *   - the simulated kill: a store rebuilt from the database file after the app was "killed"
 *     (connection abandoned, no shutdown of any kind) equals the store from before;
 *   - finish → sync: finishing queues the whole workout, and the real upload code delivers
 *     every row to a stand-in server exactly once.
 * Plus every operation, the server-rule checks, and all-or-nothing behaviour on failure.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, jest } from '@jest/globals';
import { lbToKg } from '@training-math';

import { prepareDatabase } from '@/db/database';
import { getRowsByIds, onLocalWrite, upsertRows, type SetRow } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { outboxSize, pendingRows } from '@/sync/outbox';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { OTHER_USER_ID, USER_ID } from '@/test-utils/workoutFixtures';

import {
  loadActiveWorkout,
  nextDropPosition,
  setInputFromRow,
  startActiveWorkout,
  type ActiveWorkoutOptions,
} from './activeWorkout';

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
const DEADLIFT = libraryExerciseId('deadlift');

/** A clock that moves forward one second per reading, from a fixed start. */
function tickingClock(start = '2026-11-14T09:00:00.000Z'): () => string {
  let ms = Date.parse(start);
  return () => {
    const now = new Date(ms).toISOString();
    ms += 1000;
    return now;
  };
}

/** Ids 00000000-…-000000000001, …-000000000002, … so failures are easy to read. */
function countingIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

/** Store options with a predictable clock and predictable ids, so results are repeatable. */
function options(): ActiveWorkoutOptions {
  return { clock: tickingClock(), mintId: countingIds() };
}

/** A new, empty, fully prepared in-memory database (schema + exercise library). */
async function freshDb(): Promise<SqlDriver> {
  return prepareDatabase(createNodeSqliteDriver());
}

/**
 * A driver that fails the first statement inside a transaction whose SQL matches `pattern`
 * (once), to prove a failure part-way through an operation leaves nothing behind.
 */
function faultyDriver(inner: SqlDriver): SqlDriver & { failNext(pattern: RegExp): void } {
  let pattern: RegExp | null = null;
  const trip = (sql: string) => {
    if (pattern && pattern.test(sql)) {
      pattern = null;
      throw new Error('simulated failure mid-transaction');
    }
  };
  const wrap = (tx: SqlExecutor): SqlExecutor => ({
    execAsync: (sql) => tx.execAsync(sql),
    runAsync: async (sql, params) => {
      trip(sql);
      return tx.runAsync(sql, params);
    },
    getAllAsync: (sql, params) => tx.getAllAsync(sql, params),
    getFirstAsync: (sql, params) => tx.getFirstAsync(sql, params),
  });
  return {
    ...inner,
    withTransactionAsync: (task) => inner.withTransactionAsync((tx) => task(wrap(tx))),
    failNext(p: RegExp) {
      pattern = p;
    },
  };
}

/** Every row of the user's workout tables, for "nothing changed" comparisons. */
async function dumpTables(db: SqlDriver) {
  return {
    workouts: await db.getAllAsync('select * from workouts order by id'),
    workout_exercises: await db.getAllAsync('select * from workout_exercises order by id'),
    sets: await db.getAllAsync('select * from sets order by id'),
    outbox: await outboxSize(db),
  };
}

const tempDirs: string[] = [];
afterAll(() => {
  // The "killed" connections are never closed (that is the point), so Windows may still hold
  // the files; leftovers in the OS temp folder are harmless.
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('simulated kill (NFR-3)', () => {
  it('rebuilds a store from the database file that equals the store before the kill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-b08-'));
    tempDirs.push(dir);
    const file = join(dir, 'astra.db');

    // A realistic mid-workout state, on a file-backed database like the phone's.
    const before = await prepareDatabase(createNodeSqliteDriver(file));
    const store = await startActiveWorkout(before, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const squat = await store.addExercise(SQUAT);
    const deadlift = await store.addExercise(DEADLIFT);
    await store.logSet(bench.id, { reps: 10, weight: { value: 60, unit: 'kg' }, isWarmup: true });
    await store.logSet(bench.id, { reps: 5, weight: { value: 225, unit: 'lb' }, rpe: 8 });
    await store.repeatLastSet(bench.id);
    await store.logSet(squat.id, { reps: 3, weight: { value: 140, unit: 'kg' }, rpe: 9.5 });
    const typo = await store.logSet(squat.id, { reps: 33, weight: { value: 1400, unit: 'kg' } });
    await store.removeSet(typo.id);
    await store.logSet(deadlift.id, { durationSeconds: 30 });
    await store.reorderExercise(deadlift.id, 0);
    const last = store.getSnapshot();

    // The kill: no close, no flush, no goodbye — the connection is simply abandoned.
    const after = await prepareDatabase(createNodeSqliteDriver(file));
    const rebuilt = await loadActiveWorkout(after, USER_ID);

    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.getSnapshot()).toEqual(last);
    // And the state is the one the lifter built, not just "equal to something".
    expect(last.entries.map((e) => e.exercise_id)).toEqual([DEADLIFT, BENCH, SQUAT]);
    expect(last.entries.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(last.entries[1].sets.map((s) => [s.position, s.reps, s.weight_kg, s.rpe, s.is_warmup])).toEqual([
      [0, 10, 60, null, true],
      [1, 5, 102.06, 8, false],
      [2, 5, 102.06, 8, false],
    ]);
    expect(last.entries[2].sets).toHaveLength(1);
    expect(last.entries[0].sets[0].duration_seconds).toBe(30);
    // Nothing was ever queued for upload while in progress.
    expect(await outboxSize(after)).toBe(0);

    // The rebuilt store keeps working where the old one left off.
    const next = await rebuilt!.logSet(last.entries[2].id, { reps: 3, weight: { value: 145, unit: 'kg' } });
    expect(next.position).toBe(1);
  });
});

describe('finish hands the workout to sync', () => {
  it('queues nothing while in progress, everything on finish, and pushes each row exactly once', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const squat = await store.addExercise(SQUAT);
    await store.logSet(bench.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    await store.repeatLastSet(bench.id);
    const squatWarmup = await store.logSet(squat.id, { reps: 5, weight: { value: 60, unit: 'kg' }, isWarmup: true });
    const squatWork = await store.logSet(squat.id, { reps: 5, weight: { value: 315, unit: 'lb' }, rpe: 7.5 });

    expect(await outboxSize(db)).toBe(0);

    const finished = await store.finish();
    expect(finished.ended_at).not.toBeNull();
    expect(store.getStatus()).toBe('finished');
    expect(store.getSnapshot().workout.ended_at).toBe(finished.ended_at);
    expect((await pendingRows(db, 'workouts')).map((p) => p.rowId)).toEqual([finished.id]);
    expect(await pendingRows(db, 'workout_exercises')).toHaveLength(2);
    expect(await pendingRows(db, 'sets')).toHaveLength(4);

    // The real upload code, against a stand-in server that enforces parents-before-children.
    const server = new FakeServer();
    await pushOutbox(db, server);
    expect(await outboxSize(db)).toBe(0);
    expect([...server.tables.workouts.keys()]).toEqual([finished.id]);
    expect(server.tables.workout_exercises.size).toBe(2);
    expect(server.tables.sets.size).toBe(4);
    // B10: the warm-up flag and the RPE reach the server intact (LOG-14, LOG-10 "saves and syncs").
    expect(server.tables.sets.get(squatWork.id)).toMatchObject({ reps: 5, weight_kg: 142.88, rpe: 7.5, is_warmup: false });
    expect(server.tables.sets.get(squatWarmup.id)).toMatchObject({ reps: 5, weight_kg: 60, rpe: null, is_warmup: true });
    expect(server.tables.workouts.get(finished.id)?.ended_at).toBe(finished.ended_at);

    // A second push has nothing to send and changes nothing.
    const calls = server.upsertCalls.length;
    await pushOutbox(db, server);
    expect(server.upsertCalls.length).toBe(calls);
    expect(server.tables.sets.size).toBe(4);
  });

  it('tells the sync engine (local-write listeners) once the finish commits', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const listener = jest.fn();
    onLocalWrite(db, listener);
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 1 });
    expect(listener).not.toHaveBeenCalled();
    await store.finish();
    expect(listener).toHaveBeenCalledWith('workouts');
    expect(listener).toHaveBeenCalledWith('sets');
  });

  it('never ends before it started, even if the device clock jumped backwards', async () => {
    const db = await freshDb();
    const times = ['2026-11-14T09:00:00.000Z', '2026-11-14T08:00:00.000Z'];
    const store = await startActiveWorkout(db, USER_ID, { clock: () => times.shift()!, mintId: countingIds() });
    const finished = await store.finish();
    expect(finished.ended_at).toBe(finished.started_at);
  });

  it('finishes an empty workout (what to offer instead is the screen’s call)', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    await store.finish();
    const server = new FakeServer();
    await pushOutbox(db, server);
    expect(server.tables.workouts.size).toBe(1);
  });

  it('is all or nothing: a failure mid-finish queues nothing and leaves the workout active', async () => {
    const db = faultyDriver(await freshDb());
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    const before = store.getSnapshot();
    const tables = await dumpTables(db);

    // Fail on the sets' upsert — after the workout and its entry were already saved and queued
    // inside the same transaction.
    db.failNext(/insert into sets/);
    await expect(store.finish()).rejects.toThrow('simulated failure');

    expect(await dumpTables(db)).toEqual(tables);
    expect(store.getSnapshot()).toBe(before);
    expect(store.getStatus()).toBe('active');
    // And it can simply be finished again.
    await store.finish();
    expect(await pendingRows(db, 'sets')).toHaveLength(1);
  });

  it('seals the store: every change after finish is refused', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5 });
    await store.finish();
    await expect(store.logSet(bench.id, { reps: 5 })).rejects.toThrow('finished');
    await expect(store.addExercise(SQUAT)).rejects.toThrow('finished');
    await expect(store.finish()).rejects.toThrow('finished');
    await expect(store.discard()).rejects.toThrow('finished');
  });
});

describe('server rules are checked before anything is saved', () => {
  it.each([
    [{ rpe: 11 }, /rpe/],
    [{ reps: -1 }, /reps/],
    [{ reps: 2.5 }, /reps/],
    [{ weight: { value: 10000, unit: 'kg' as const } }, /weightKg/],
    [{ weight: { value: -5, unit: 'lb' as const } }, /weightKg/],
    [{ weight: { value: Number.NaN, unit: 'lb' as const } }, /lb/],
    [{ dropSetPosition: 0 }, /dropSetPosition/],
    [{ durationSeconds: -1 }, /durationSeconds/],
  ])('refuses %o with a RangeError and writes nothing', async (input, message) => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const tables = await dumpTables(db);
    const before = store.getSnapshot();

    await expect(store.logSet(bench.id, input)).rejects.toThrow(RangeError);
    await expect(store.logSet(bench.id, input)).rejects.toThrow(message);

    expect(await dumpTables(db)).toEqual(tables);
    expect(store.getSnapshot()).toBe(before);
  });

  it('refuses a bad correction too, keeping the original set', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const set = await store.logSet(bench.id, { reps: 5, rpe: 8 });
    await expect(store.updateSet(set.id, { reps: 5, rpe: 0 })).rejects.toThrow(RangeError);
    expect(await getRowsByIds(db, 'sets', [set.id])).toEqual([set]);
  });

  it('refuses an exercise that is not in the user’s library (the server would refuse it at upload)', async () => {
    const db = await freshDb();
    const theirs = {
      id: 'd0000000-0000-4000-8000-000000000009',
      owner_id: OTHER_USER_ID,
      name: 'Their Custom Lift',
      primary_muscle: null,
      equipment: null,
      slug: null,
      deleted_at: null,
      created_at: '2026-11-14T08:00:00.000Z',
      updated_at: '2026-11-14T08:00:00.000Z',
    };
    await upsertRows(db, 'exercises', [theirs]);
    const store = await startActiveWorkout(db, USER_ID, options());
    await expect(store.addExercise('ffffffff-ffff-4fff-8fff-ffffffffffff')).rejects.toThrow('library');
    await expect(store.addExercise(theirs.id)).rejects.toThrow('library');
    expect(store.getSnapshot().entries).toEqual([]);
  });

  it('accepts the user’s own custom exercise', async () => {
    const db = await freshDb();
    const mine = {
      id: 'd0000000-0000-4000-8000-000000000010',
      owner_id: USER_ID,
      name: 'Landmine Press',
      primary_muscle: null,
      equipment: null,
      slug: null,
      deleted_at: null,
      created_at: '2026-11-14T08:00:00.000Z',
      updated_at: '2026-11-14T08:00:00.000Z',
    };
    await upsertRows(db, 'exercises', [mine]);
    const store = await startActiveWorkout(db, USER_ID, options());
    const entry = await store.addExercise(mine.id);
    expect(entry.exercise_id).toBe(mine.id);
  });
});

describe('operations', () => {
  it('starts a blank, public, untitled workout', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    expect(store.getSnapshot()).toEqual({
      workout: {
        id: '00000000-0000-4000-8000-000000000001',
        user_id: USER_ID,
        title: null,
        notes: null,
        started_at: '2026-11-14T09:00:00.000Z',
        ended_at: null,
        visibility: 'public',
        program_workout_id: null,
        created_at: '2026-11-14T09:00:00.000Z',
        updated_at: '2026-11-14T09:00:00.000Z',
      },
      entries: [],
    });
    expect(store.getStatus()).toBe('active');
  });

  it('mints real random ids when none are injected', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID);
    expect(store.getSnapshot().workout.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses to start a second workout while one is in progress', async () => {
    const db = await freshDb();
    await startActiveWorkout(db, USER_ID, options());
    await expect(startActiveWorkout(db, USER_ID, options())).rejects.toThrow('already in progress');
  });

  it('starts a new workout once the previous one is finished or discarded', async () => {
    const db = await freshDb();
    const first = await startActiveWorkout(db, USER_ID, options());
    await first.finish();
    const second = await startActiveWorkout(db, USER_ID, { clock: tickingClock('2026-11-15T09:00:00.000Z') });
    await second.discard();
    await expect(startActiveWorkout(db, USER_ID)).resolves.toBeDefined();
  });

  it('logs sets in kg or lb, storing kg rounded to the server column', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const kg = await store.logSet(bench.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    const lb = await store.logSet(bench.id, { reps: 5, weight: { value: 225, unit: 'lb' }, rpe: 9.55 });
    expect(kg).toMatchObject({ position: 0, reps: 5, weight_kg: 100, rpe: null, is_warmup: false });
    expect(lb).toMatchObject({ position: 1, weight_kg: 102.06, rpe: 9.6 });
    expect(lb.weight_kg).toBeCloseTo(lbToKg(225), 1);
  });

  it('repeats the last set as a new set with the same values (NFR-2)', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const first = await store.logSet(bench.id, {
      reps: 8,
      weight: { value: 80, unit: 'kg' },
      rpe: 7,
      isWarmup: true,
      dropSetPosition: 1,
      durationSeconds: 40,
    });
    const copy = await store.repeatLastSet(bench.id);
    const strip = ({ id: _id, position: _p, created_at: _c, updated_at: _u, ...values }: SetRow) => values;
    expect(strip(copy)).toEqual(strip(first));
    expect(copy.id).not.toBe(first.id);
    expect(copy.position).toBe(1);
    expect(store.getSnapshot().entries[0].sets).toHaveLength(2);
  });

  it('flips a logged set to warm-up and back via setInputFromRow, changing nothing else (B10)', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    // Pounds, so the stored kg has two decimals that a sloppy round trip could disturb.
    const logged = await store.logSet(bench.id, {
      reps: 8,
      weight: { value: 137.5, unit: 'lb' },
      rpe: 6.5,
      dropSetPosition: 1,
      durationSeconds: 30,
    });
    const strip = ({ is_warmup: _w, updated_at: _u, ...values }: SetRow) => values;

    const warm = await store.updateSet(logged.id, { ...setInputFromRow(logged), isWarmup: true });
    expect(warm.is_warmup).toBe(true);
    expect(strip(warm)).toEqual(strip(logged));

    const back = await store.updateSet(warm.id, { ...setInputFromRow(warm), isWarmup: false });
    expect(back.is_warmup).toBe(false);
    expect(strip(back)).toEqual(strip(logged));
  });

  it('setInputFromRow keeps a weightless (bodyweight) set weightless', () => {
    const row: SetRow = {
      id: 'x',
      workout_exercise_id: 'e',
      position: 0,
      reps: 8,
      weight_kg: null,
      rpe: null,
      is_warmup: false,
      drop_set_position: null,
      duration_seconds: null,
      score: null,
      notes: null,
      created_at: '',
      updated_at: '',
    };
    expect(setInputFromRow(row)).toEqual({
      reps: 8,
      weight: null,
      rpe: null,
      isWarmup: false,
      dropSetPosition: null,
      durationSeconds: null,
      score: null,
      notes: null,
    });
  });

  it('refuses to repeat when the exercise has no sets yet', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    await expect(store.repeatLastSet(bench.id)).rejects.toThrow('no set to repeat');
  });

  it('corrects a set in place, keeping its id, position and creation time', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5 });
    const set = await store.logSet(bench.id, { reps: 55, weight: { value: 100, unit: 'kg' } });
    const fixed = await store.updateSet(set.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    expect(fixed).toMatchObject({ id: set.id, position: 1, reps: 5, created_at: set.created_at });
    expect(fixed.updated_at > set.updated_at).toBe(true);
  });

  it('removes a set and closes the gap in positions', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const a = await store.logSet(bench.id, { reps: 1 });
    const b = await store.logSet(bench.id, { reps: 2 });
    const c = await store.logSet(bench.id, { reps: 3 });
    await store.removeSet(b.id);
    const sets = store.getSnapshot().entries[0].sets;
    expect(sets.map((s) => [s.id, s.position])).toEqual([
      [a.id, 0],
      [c.id, 1],
    ]);
  });

  it('removes an exercise with its sets and closes the gap', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const squat = await store.addExercise(SQUAT);
    const dead = await store.addExercise(DEADLIFT);
    const set = await store.logSet(squat.id, { reps: 5 });
    await store.removeExercise(squat.id);
    expect(store.getSnapshot().entries.map((e) => [e.id, e.position])).toEqual([
      [bench.id, 0],
      [dead.id, 1],
    ]);
    expect(await getRowsByIds(db, 'sets', [set.id])).toEqual([]);
  });

  it('reorders exercises, keeping positions 0…n-1', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const a = await store.addExercise(BENCH);
    const b = await store.addExercise(SQUAT);
    const c = await store.addExercise(DEADLIFT);
    await store.reorderExercise(a.id, 2);
    expect(store.getSnapshot().entries.map((e) => e.id)).toEqual([b.id, c.id, a.id]);
    await store.reorderExercise(a.id, 0);
    expect(store.getSnapshot().entries.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(store.getSnapshot().entries.map((e) => e.position)).toEqual([0, 1, 2]);
    await expect(store.reorderExercise(a.id, 3)).rejects.toThrow(RangeError);
    await expect(store.reorderExercise(a.id, -1)).rejects.toThrow(RangeError);
  });

  it('rejects ids that are not part of this workout', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    await expect(store.logSet('nope', { reps: 1 })).rejects.toThrow('No exercise');
    await expect(store.removeSet('nope')).rejects.toThrow('No set');
  });

  it('is all or nothing: a failure mid-removal leaves the database and snapshot untouched', async () => {
    const db = faultyDriver(await freshDb());
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    await store.addExercise(SQUAT);
    await store.addExercise(DEADLIFT);
    await store.logSet(bench.id, { reps: 5 });
    const before = store.getSnapshot();
    const tables = await dumpTables(db);

    // The delete runs, then re-numbering the exercises after it fails.
    db.failNext(/insert into workout_exercises/);
    await expect(store.removeExercise(bench.id)).rejects.toThrow('simulated failure');

    expect(await dumpTables(db)).toEqual(tables);
    expect(store.getSnapshot()).toBe(before);
  });

  it('runs overlapping calls one at a time, so quick taps never collide', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5 });
    await Promise.all([
      store.repeatLastSet(bench.id),
      store.repeatLastSet(bench.id),
      store.logSet(bench.id, { reps: 3 }),
    ]);
    expect(store.getSnapshot().entries[0].sets.map((s) => [s.position, s.reps])).toEqual([
      [0, 5],
      [1, 5],
      [2, 5],
      [3, 3],
    ]);
  });

  it('notifies subscribers after each change, and keeps the same snapshot object between changes', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    await store.addExercise(BENCH);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(first);
    unsubscribe();
    await store.addExercise(SQUAT);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('discards the workout from the phone completely, queueing nothing', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5 });
    const listener = jest.fn();
    store.subscribe(listener);
    await store.discard();
    expect(store.getStatus()).toBe('discarded');
    expect(listener).toHaveBeenCalled();
    expect(await dumpTables(db)).toEqual({ workouts: [], workout_exercises: [], sets: [], outbox: 0 });
    expect(await loadActiveWorkout(db, USER_ID)).toBeNull();
    await expect(store.logSet(bench.id, { reps: 1 })).rejects.toThrow('discarded');
  });
});

describe('supersets, drop sets and timed work (B11)', () => {
  const PULLUP = libraryExerciseId('pullups');

  /** A workout with `n` exercises (bench, squat, deadlift, …) and its store. */
  async function workoutWith(n: number) {
    const db = faultyDriver(await freshDb());
    const store = await startActiveWorkout(db, USER_ID, options());
    const ids = [BENCH, SQUAT, DEADLIFT, PULLUP].slice(0, n);
    const entries = [];
    for (const id of ids) entries.push(await store.addExercise(id));
    return { db, store, entries };
  }

  /** Each exercise's superset number, in workout order. */
  const groupsOf = (store: { getSnapshot(): { entries: { superset_group: number | null }[] } }) =>
    store.getSnapshot().entries.map((e) => e.superset_group);

  it('links two exercises with one fresh number, saved to both rows (LOG-11)', async () => {
    const { db, store, entries } = await workoutWith(3);
    await store.linkWithPrevious(entries[1].id);
    expect(groupsOf(store)).toEqual([1, 1, null]);
    // Saved to the device, not just the snapshot.
    const rows = await getRowsByIds(db, 'workout_exercises', [entries[0].id, entries[1].id]);
    expect(rows.map((r) => r.superset_group)).toEqual([1, 1]);
  });

  it('chains a third exercise into the existing superset (a tri-set)', async () => {
    const { store, entries } = await workoutWith(3);
    await store.linkWithPrevious(entries[1].id);
    await store.linkWithPrevious(entries[2].id);
    expect(groupsOf(store)).toEqual([1, 1, 1]);
  });

  it('linking upward joins the superset the exercise is already in', async () => {
    const { store, entries } = await workoutWith(3);
    await store.linkWithPrevious(entries[2].id); // 2–3 linked
    await store.linkWithPrevious(entries[1].id); // 1 joins them
    expect(groupsOf(store)).toEqual([1, 1, 1]);
  });

  it('linking two supersets together merges them', async () => {
    const { store, entries } = await workoutWith(4);
    await store.linkWithPrevious(entries[1].id);
    await store.linkWithPrevious(entries[3].id);
    expect(groupsOf(store)).toEqual([1, 1, 2, 2]);
    await store.linkWithPrevious(entries[2].id);
    expect(groupsOf(store)).toEqual([1, 1, 1, 1]);
  });

  it('unlinking a pair clears both (a superset of one is no superset)', async () => {
    const { store, entries } = await workoutWith(2);
    await store.linkWithPrevious(entries[1].id);
    await store.unlinkFromPrevious(entries[1].id);
    expect(groupsOf(store)).toEqual([null, null]);
  });

  it('unlinking inside a tri-set splits it at that point', async () => {
    const { store, entries } = await workoutWith(4);
    await store.linkWithPrevious(entries[1].id);
    await store.linkWithPrevious(entries[2].id);
    await store.linkWithPrevious(entries[3].id);
    await store.unlinkFromPrevious(entries[2].id);
    // 1–2 keep their number; 3–4 get a fresh one.
    expect(groupsOf(store)).toEqual([1, 1, 2, 2]);
    await store.unlinkFromPrevious(entries[1].id);
    expect(groupsOf(store)).toEqual([null, null, 2, 2]);
  });

  it('allocates a number no other superset holds, even after unlink churn', async () => {
    const { store, entries } = await workoutWith(4);
    await store.linkWithPrevious(entries[1].id); // [1, 1, -, -]
    await store.linkWithPrevious(entries[3].id); // [1, 1, 2, 2]
    await store.unlinkFromPrevious(entries[1].id); // [-, -, 2, 2]
    await store.linkWithPrevious(entries[1].id); // fresh: max(2) + 1
    expect(groupsOf(store)).toEqual([3, 3, 2, 2]);
  });

  it('refuses the first exercise, and does nothing for a link that is already there or absent', async () => {
    const { db, store, entries } = await workoutWith(2);
    await expect(store.linkWithPrevious(entries[0].id)).rejects.toThrow('first exercise');
    await store.unlinkFromPrevious(entries[1].id);
    await store.unlinkFromPrevious(entries[0].id);
    expect(groupsOf(store)).toEqual([null, null]);
    await store.linkWithPrevious(entries[1].id);
    const tables = await dumpTables(db);
    await store.linkWithPrevious(entries[1].id);
    expect(await dumpTables(db)).toEqual(tables);
  });

  it('is all or nothing: a failure part-way through a link writes neither row', async () => {
    const { db, store, entries } = await workoutWith(2);
    const before = store.getSnapshot();
    const tables = await dumpTables(db);
    db.failNext(/insert into workout_exercises/);
    await expect(store.linkWithPrevious(entries[1].id)).rejects.toThrow('simulated failure');
    expect(await dumpTables(db)).toEqual(tables);
    expect(store.getSnapshot()).toBe(before);
  });

  it('keeps superset numbers through reorder (display merges only neighbours)', async () => {
    const { store, entries } = await workoutWith(3);
    await store.linkWithPrevious(entries[1].id);
    await store.reorderExercise(entries[0].id, 2);
    expect(store.getSnapshot().entries.map((e) => [e.id, e.superset_group])).toEqual([
      [entries[1].id, 1],
      [entries[2].id, null],
      [entries[0].id, 1],
    ]);
  });

  it('links by what the screen shows: a member moved away is not pulled back in', async () => {
    const { store, entries } = await workoutWith(3);
    const [a, b, c] = entries;
    await store.linkWithPrevious(b.id); // [A, B] superset
    await store.reorderExercise(b.id, 2); // [A(1), C, B(1)] — nothing shown as a superset
    await store.linkWithPrevious(b.id); // the lifter links C and B only
    expect(store.getSnapshot().entries.map((e) => [e.id, e.superset_group])).toEqual([
      [a.id, null], // the stray lost its number: it no longer shows as part of anything
      [c.id, 1],
      [b.id, 1],
    ]);
  });

  it('removes a whole drop set in one transaction, renumbering the rest', async () => {
    const { db, store, entries } = await workoutWith(1);
    const bench = entries[0].id;
    const first = await store.logSet(bench, { reps: 5 });
    const top = await store.logSet(bench, { reps: 8 });
    const drop = await store.logSet(bench, { reps: 8, dropSetPosition: 1 });
    const last = await store.logSet(bench, { reps: 3 });

    const before = store.getSnapshot();
    const tables = await dumpTables(db);
    db.failNext(/insert into sets/); // the renumbering after the delete fails
    await expect(store.removeSets([top.id, drop.id])).rejects.toThrow('simulated failure');
    expect(await dumpTables(db)).toEqual(tables);
    expect(store.getSnapshot()).toBe(before);

    await store.removeSets([top.id, drop.id]);
    expect(store.getSnapshot().entries[0].sets.map((s) => [s.id, s.position])).toEqual([
      [first.id, 0],
      [last.id, 1],
    ]);
    await expect(store.removeSets(['nope'])).rejects.toThrow('No set');
  });

  it('updates several sets in one transaction, or none if one value is refused', async () => {
    const { db, store, entries } = await workoutWith(1);
    const top = await store.logSet(entries[0].id, { reps: 8 });
    const drop = await store.logSet(entries[0].id, { reps: 8, dropSetPosition: 1 });
    const tables = await dumpTables(db);
    await expect(
      store.updateSets([
        { setId: top.id, input: { ...setInputFromRow(top), isWarmup: true } },
        { setId: drop.id, input: { ...setInputFromRow(drop), rpe: 11 } },
      ]),
    ).rejects.toThrow(RangeError);
    expect(await dumpTables(db)).toEqual(tables);

    await store.updateSets(
      [top, drop].map((set) => ({ setId: set.id, input: { ...setInputFromRow(set), isWarmup: true } })),
    );
    expect(store.getSnapshot().entries[0].sets.map((s) => [s.is_warmup, s.drop_set_position])).toEqual([
      [true, null],
      [true, 1],
    ]);
  });

  it('logs a drop set as a top set plus numbered drops (LOG-12)', async () => {
    const { store, entries } = await workoutWith(1);
    const bench = entries[0].id;
    expect(nextDropPosition(store.getSnapshot().entries[0].sets)).toBeNull();
    await store.logSet(bench, { reps: 8, weight: { value: 225, unit: 'lb' } });
    for (const lb of [185, 155]) {
      const dropSetPosition = nextDropPosition(store.getSnapshot().entries[0].sets);
      await store.logSet(bench, { reps: 8, weight: { value: lb, unit: 'lb' }, dropSetPosition });
    }
    expect(store.getSnapshot().entries[0].sets.map((s) => s.drop_set_position)).toEqual([null, 1, 2]);
    expect(nextDropPosition(store.getSnapshot().entries[0].sets)).toBe(3);
  });

  it('saves a score trimmed, a blank score as none, and refuses one over 100 characters (LOG-13)', async () => {
    const { store, entries } = await workoutWith(1);
    const scored = await store.logSet(entries[0].id, { durationSeconds: 1200, score: '  7 rounds + 12 reps ' });
    expect(scored).toMatchObject({ duration_seconds: 1200, score: '7 rounds + 12 reps', reps: null });
    const blank = await store.logSet(entries[0].id, { reps: 5, score: '   ' });
    expect(blank.score).toBeNull();
    await expect(store.logSet(entries[0].id, { score: 'x'.repeat(101) })).rejects.toThrow(/score/);
    // The score round-trips through a correction and a repeat.
    const fixed = await store.updateSet(scored.id, { ...setInputFromRow(scored), isWarmup: true });
    expect(fixed.score).toBe('7 rounds + 12 reps');
    const copy = await store.repeatLastSet(entries[0].id);
    expect(copy.score).toBeNull();
    await store.logSet(entries[0].id, { score: 'AMRAP 9' });
    expect((await store.repeatLastSet(entries[0].id)).score).toBe('AMRAP 9');
  });

  it('uploads supersets, drops, times and scores intact on finish (the "syncs" half)', async () => {
    const { db, store, entries } = await workoutWith(3);
    await store.linkWithPrevious(entries[1].id);
    const top = await store.logSet(entries[0].id, { reps: 8, weight: { value: 100, unit: 'kg' } });
    const drop = await store.logSet(entries[0].id, { reps: 8, weight: { value: 80, unit: 'kg' }, dropSetPosition: 1 });
    const timed = await store.logSet(entries[2].id, { durationSeconds: 452, reps: 100 });
    const scored = await store.logSet(entries[2].id, { score: '7 rounds + 12 reps' });
    await store.finish();

    const server = new FakeServer();
    await pushOutbox(db, server);
    expect(server.tables.workout_exercises.get(entries[0].id)?.superset_group).toBe(1);
    expect(server.tables.workout_exercises.get(entries[1].id)?.superset_group).toBe(1);
    expect(server.tables.workout_exercises.get(entries[2].id)?.superset_group).toBeNull();
    expect(server.tables.sets.get(top.id)).toMatchObject({ drop_set_position: null });
    expect(server.tables.sets.get(drop.id)).toMatchObject({ drop_set_position: 1, weight_kg: 80 });
    expect(server.tables.sets.get(timed.id)).toMatchObject({ duration_seconds: 452, reps: 100 });
    expect(server.tables.sets.get(scored.id)).toMatchObject({ score: '7 rounds + 12 reps' });
  });
});

describe('loadActiveWorkout', () => {
  it('returns null when nothing is in progress', async () => {
    const db = await freshDb();
    expect(await loadActiveWorkout(db, USER_ID)).toBeNull();
    const store = await startActiveWorkout(db, USER_ID, options());
    await store.finish();
    expect(await loadActiveWorkout(db, USER_ID)).toBeNull();
  });

  it('only ever finds the signed-in user’s workout', async () => {
    const db = await freshDb();
    await startActiveWorkout(db, OTHER_USER_ID, options());
    expect(await loadActiveWorkout(db, USER_ID)).toBeNull();
    expect(await loadActiveWorkout(db, OTHER_USER_ID)).not.toBeNull();
  });

  it('picks the newest if several unfinished workouts somehow exist, leaving the others alone', async () => {
    const db = await freshDb();
    const older = await startActiveWorkout(db, USER_ID, options());
    // Bypass the store's one-at-a-time rule by writing a second draft straight into the table.
    const newer = { ...older.getSnapshot().workout, id: 'e0000000-0000-4000-8000-000000000001', started_at: '2026-11-14T10:00:00.000Z' };
    await upsertRows(db, 'workouts', [newer]);
    const loaded = await loadActiveWorkout(db, USER_ID);
    expect(loaded?.getSnapshot().workout.id).toBe(newer.id);
    expect(await getRowsByIds(db, 'workouts', [older.getSnapshot().workout.id])).toHaveLength(1);
  });
});

describe('notes at all three levels (LOG-3, B12)', () => {
  /** A started workout with a bench entry and one logged set. */
  async function benchWorkout(db?: SqlDriver) {
    const driver = db ?? (await freshDb());
    const store = await startActiveWorkout(driver, USER_ID, options());
    const bench = await store.addExercise(BENCH);
    const set = await store.logSet(bench.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    return { db: driver, store, bench, set };
  }

  it('saves a title, a workout note, an exercise note and a set note, trimmed', async () => {
    const { store, bench, set } = await benchWorkout();
    await store.setTitle('  Push day ');
    await store.setNotes(' slept badly ');
    await store.setEntryNotes(bench.id, ' grip slipping ');
    await store.setSetNotes(set.id, ' elbow twinged on rep 3 ');
    const snap = store.getSnapshot();
    expect(snap.workout).toMatchObject({ title: 'Push day', notes: 'slept badly' });
    expect(snap.entries[0].notes).toBe('grip slipping');
    expect(snap.entries[0].sets[0]).toMatchObject({ notes: 'elbow twinged on rep 3', reps: 5, weight_kg: 100 });
  });

  it('clears a note or title saved blank', async () => {
    const { store, bench, set } = await benchWorkout();
    await store.setTitle('Push');
    await store.setNotes('n');
    await store.setEntryNotes(bench.id, 'e');
    await store.setSetNotes(set.id, 's');
    await store.setTitle('   ');
    await store.setNotes('');
    await store.setEntryNotes(bench.id, null);
    await store.setSetNotes(set.id, ' ');
    const snap = store.getSnapshot();
    expect(snap.workout).toMatchObject({ title: null, notes: null });
    expect(snap.entries[0].notes).toBeNull();
    expect(snap.entries[0].sets[0].notes).toBeNull();
  });

  it('refuses text past each server cap before writing anything', async () => {
    const { db, store, bench, set } = await benchWorkout();
    const before = await dumpTables(db);
    await expect(store.setTitle('x'.repeat(101))).rejects.toThrow(RangeError);
    await expect(store.setNotes('x'.repeat(2001))).rejects.toThrow(RangeError);
    await expect(store.setEntryNotes(bench.id, 'x'.repeat(1001))).rejects.toThrow(RangeError);
    await expect(store.setSetNotes(set.id, 'x'.repeat(501))).rejects.toThrow(RangeError);
    await expect(store.logSet(bench.id, { reps: 1, notes: 'x'.repeat(501) })).rejects.toThrow(/notes/);
    expect(await dumpTables(db)).toEqual(before);
    // Exactly at the caps is fine.
    await store.setTitle('x'.repeat(100));
    await store.setNotes('x'.repeat(2000));
    await store.setEntryNotes(bench.id, 'x'.repeat(1000));
    await store.setSetNotes(set.id, 'x'.repeat(500));
    expect(store.getSnapshot().entries[0].sets[0].notes).toHaveLength(500);
  });

  it('keeps a set note through a warm-up flip, but Repeat does not copy it', async () => {
    const { store, bench, set } = await benchWorkout();
    await store.setSetNotes(set.id, 'belt on');
    const current = store.getSnapshot().entries[0].sets[0];
    const warm = await store.updateSet(set.id, { ...setInputFromRow(current), isWarmup: true });
    expect(warm).toMatchObject({ is_warmup: true, notes: 'belt on' });
    const copy = await store.repeatLastSet(bench.id);
    expect(copy).toMatchObject({ reps: 5, weight_kg: 100, is_warmup: true, notes: null });
  });

  it('a set note saved right after a queued warm-up flip keeps the flip', async () => {
    const { store, set } = await benchWorkout();
    // Both calls are made before either runs: the note must read the set after the flip.
    const flip = store.updateSet(set.id, { ...setInputFromRow(set), isWarmup: true });
    const note = store.setSetNotes(set.id, 'felt light');
    await Promise.all([flip, note]);
    expect(store.getSnapshot().entries[0].sets[0]).toMatchObject({ is_warmup: true, notes: 'felt light' });
  });

  it('survives a killed app: a reloaded store holds all three levels', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-b12-'));
    tempDirs.push(dir);
    const file = join(dir, 'astra.db');
    const { store, bench, set } = await benchWorkout(await prepareDatabase(createNodeSqliteDriver(file)));
    await store.setTitle('Push day');
    await store.setNotes('slept badly');
    await store.setEntryNotes(bench.id, 'grip slipping');
    await store.setSetNotes(set.id, 'elbow twinged');

    // The kill: the first connection is abandoned, a new one opens the same file.
    const rebuilt = await loadActiveWorkout(await prepareDatabase(createNodeSqliteDriver(file)), USER_ID);
    expect(rebuilt!.getSnapshot()).toEqual(store.getSnapshot());
    expect(rebuilt!.getSnapshot().workout).toMatchObject({ title: 'Push day', notes: 'slept badly' });
    expect(rebuilt!.getSnapshot().entries[0]).toMatchObject({ notes: 'grip slipping' });
    expect(rebuilt!.getSnapshot().entries[0].sets[0].notes).toBe('elbow twinged');
  });

  it('uploads every level of note on finish (the "syncs" half)', async () => {
    const { db, store, bench, set } = await benchWorkout();
    await store.setTitle('Push day');
    await store.setNotes('slept badly');
    await store.setEntryNotes(bench.id, 'grip slipping');
    await store.setSetNotes(set.id, 'elbow twinged');
    const finished = await store.finish();
    const server = new FakeServer();
    await pushOutbox(db, server);
    expect(server.tables.workouts.get(finished.id)).toMatchObject({ title: 'Push day', notes: 'slept badly' });
    expect(server.tables.workout_exercises.get(bench.id)).toMatchObject({ notes: 'grip slipping' });
    expect(server.tables.sets.get(set.id)).toMatchObject({ notes: 'elbow twinged' });
  });

  it('refuses every note and title change once the workout is finished', async () => {
    const { store, bench, set } = await benchWorkout();
    await store.finish();
    await expect(store.setTitle('late')).rejects.toThrow(/finished/);
    await expect(store.setNotes('late')).rejects.toThrow(/finished/);
    await expect(store.setEntryNotes(bench.id, 'late')).rejects.toThrow(/finished/);
    await expect(store.setSetNotes(set.id, 'late')).rejects.toThrow(/finished/);
  });

  it('keeps notes off the upload queue while the workout is in progress', async () => {
    const { db, store, bench, set } = await benchWorkout();
    await store.setTitle('Push');
    await store.setEntryNotes(bench.id, 'e');
    await store.setSetNotes(set.id, 's');
    expect(await outboxSize(db)).toBe(0);
  });
});
