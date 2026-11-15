/**
 * Tests for "Start next session" (PRG-3, LOG-1, B35) — the step's definition of done: running a
 * program, each tap of Workout opens the correct next session with its targets, advancing week
 * by week. Covers the prefill (title, exercises in program order, target notes in the lifter's
 * unit, no invented sets), skipping a slot whose exercise is gone, the refusals, the finish that
 * advances the run atomically (a failed finish moves nothing), the title cut, and the whole
 * offline story through sync: author a program, run a session, then reconnect once — every row
 * lands, in an order the server's foreign keys accept. Real SQLite (node driver), no network.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { getRowsByIds } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { createCustomExercise, deleteCustomExercise } from '@/library/customExercises';
import { libraryExerciseId } from '@/library/uuidv5';
import { addProgramExercise, addProgramWorkout, addWeek, createProgram } from '@/programs/programs';
import { ProgramRunError, readActiveRun, startProgramRun } from '@/programs/programRuns';
import { pullChanges } from '@/sync/pull';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { startActiveWorkout, type ActiveWorkoutOptions } from './activeWorkout';
import { clearSessionWorkout, currentSessionWorkout, startSessionWorkout } from './activeWorkoutSession';
import { programSessionTitle, startProgramSession } from './startProgramSession';

const USER = 'a0000000-0000-4000-8000-000000000001';
const T0 = '2026-11-15T10:00:00.000Z';
const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
const ROW = libraryExerciseId('barbell_row');

let db: SqlDriver;
let ids = 0;
const newId = () => `b0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const opts = { now: T0, newId };

/** Store options: a clock ticking a minute per reading, and predictable ids. */
function storeOptions(): ActiveWorkoutOptions {
  let ms = Date.parse('2026-11-16T09:00:00.000Z');
  return {
    clock: () => {
      const now = new Date(ms).toISOString();
      ms += 60_000;
      return now;
    },
    mintId: newId,
  };
}

beforeEach(async () => {
  ids = 0;
  db = await prepareDatabase(createNodeSqliteDriver());
});

afterEach(() => clearSessionWorkout());

/**
 * "Strength Block": 2 weeks × 2 workouts. Day A = squat 3 × 5 @ 225 lb RPE 8, bench 3 × 8;
 * Day B = row 4 sets. Week 2 repeats it heavier. Returns the program id.
 */
async function strengthBlock(): Promise<string> {
  const p = await createProgram(db, USER, 'Strength Block', opts);
  for (const squatLb of [225, 235]) {
    const week = await addWeek(db, USER, p.id, opts);
    const dayA = await addProgramWorkout(db, USER, week.id, 'Day A', opts);
    await addProgramExercise(db, USER, dayA.id, { exerciseId: SQUAT, targets: { sets: 3, reps: 5, weight: { value: squatLb, unit: 'lb' }, rpe: 8 } }, opts);
    await addProgramExercise(db, USER, dayA.id, { exerciseId: BENCH, targets: { sets: 3, reps: 8, weight: null, rpe: null } }, opts);
    const dayB = await addProgramWorkout(db, USER, week.id, 'Day B', opts);
    await addProgramExercise(db, USER, dayB.id, { exerciseId: ROW, targets: { sets: 4, reps: null, weight: null, rpe: null } }, opts);
  }
  return p.id;
}

describe('startProgramSession — the step DoD', () => {
  it('each tap of Workout opens the correct next session with its targets, advancing week by week', async () => {
    const programId = await strengthBlock();
    await startProgramRun(db, USER, programId, opts);

    const expected = [
      { title: 'Strength Block — Week 1 · Day A', exercises: [SQUAT, BENCH], notes: ['Target: 3 × 5 @ 225 lb · RPE 8', 'Target: 3 × 8'] },
      { title: 'Strength Block — Week 1 · Day B', exercises: [ROW], notes: ['Target: 4 sets'] },
      { title: 'Strength Block — Week 2 · Day A', exercises: [SQUAT, BENCH], notes: ['Target: 3 × 5 @ 235 lb · RPE 8', 'Target: 3 × 8'] },
      { title: 'Strength Block — Week 2 · Day B', exercises: [ROW], notes: ['Target: 4 sets'] },
    ];
    for (const session of expected) {
      const active = await readActiveRun(db, USER);
      expect(active?.nextSession && `${active.tree.program.name} — Week ${active.nextSession.week.number} · ${active.nextSession.workout.label}`).toBe(session.title);

      const store = await startProgramSession(db, USER, 'lb', storeOptions());
      expect(currentSessionWorkout(USER)).toBe(store);
      const snap = store.getSnapshot();
      expect(snap.workout.title).toBe(session.title);
      expect(snap.workout.program_workout_id).toBe(active?.nextSession?.workout.workout.id);
      expect(snap.entries.map((e) => e.exercise_id)).toEqual(session.exercises);
      expect(snap.entries.map((e) => e.notes)).toEqual(session.notes);
      // Targets are a prescription, never pre-logged work.
      expect(snap.entries.every((e) => e.sets.length === 0)).toBe(true);

      await store.logSet(snap.entries[0].id, { reps: 5 });
      await store.finish();
      clearSessionWorkout();
    }
    // After the last session the run is over: nothing active, the tab offers a plain start again.
    expect(await readActiveRun(db, USER)).toBeNull();
    const runs = await db.getAllAsync<{ ended_at: string | null }>('select ended_at from program_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].ended_at).not.toBeNull();
  });

  it('writes target weights in the lifter’s unit', async () => {
    const programId = await strengthBlock();
    await startProgramRun(db, USER, programId, opts);
    const store = await startProgramSession(db, USER, 'kg', storeOptions());
    expect(store.getSnapshot().entries[0].notes).toMatch(/^Target: 3 × 5 @ 102\.\d+ kg · RPE 8$/);
  });

  it('an empty workout during a run carries no link and advances nothing', async () => {
    const programId = await strengthBlock();
    await startProgramRun(db, USER, programId, opts);
    const store = await startSessionWorkout(db, USER, storeOptions());
    expect(store.getSnapshot().workout.program_workout_id).toBeNull();
    await store.finish();
    expect((await readActiveRun(db, USER))?.nextSession?.workout.label).toBe('Day A');
    expect((await readActiveRun(db, USER))?.nextSession?.week.number).toBe(1);
  });

  it('finishing a session from an earlier run of the program leaves a restarted run at Week 1', async () => {
    const programId = await strengthBlock();
    await startProgramRun(db, USER, programId, { now: '2026-11-16T08:00:00.000Z', newId });
    const store = await startProgramSession(db, USER, 'lb', storeOptions()); // started 09:00
    // Meanwhile (say on another phone) the program is stopped and started again.
    await startProgramRun(db, USER, programId, { now: '2026-11-16T09:30:00.000Z', newId });
    await store.finish();
    const active = await readActiveRun(db, USER);
    expect(active?.nextSession?.week.number).toBe(1);
    expect(active?.nextSession?.workout.label).toBe('Day A');
  });

  it('discarding a program session leaves the run where it was', async () => {
    const programId = await strengthBlock();
    await startProgramRun(db, USER, programId, opts);
    const store = await startProgramSession(db, USER, 'lb', storeOptions());
    await store.discard();
    clearSessionWorkout();
    expect((await readActiveRun(db, USER))?.nextSession?.workout.label).toBe('Day A');
  });
});

describe('startProgramSession — edges', () => {
  it('skips a slot whose exercise this phone can no longer log, keeping the rest', async () => {
    const custom = await createCustomExercise(db, USER, { name: 'Pin Squat', primaryMuscle: null, equipment: null }, opts);
    const p = await createProgram(db, USER, 'P', opts);
    const week = await addWeek(db, USER, p.id, opts);
    const day = await addProgramWorkout(db, USER, week.id, null, opts);
    await addProgramExercise(db, USER, day.id, { exerciseId: custom.id, targets: { sets: 2, reps: 3, weight: null, rpe: null } }, opts);
    await addProgramExercise(db, USER, day.id, { exerciseId: BENCH, targets: { sets: 1, reps: 1, weight: null, rpe: null } }, opts);
    await startProgramRun(db, USER, p.id, opts);
    // The exercise row disappears for good (as an account wipe or a server cascade would leave it).
    await deleteCustomExercise(db, USER, custom.id, opts);
    await db.runAsync('delete from exercises where id = ?', [custom.id]);

    const store = await startProgramSession(db, USER, 'lb', storeOptions());
    expect(store.getSnapshot().workout.title).toBe('P — Week 1 · Workout 1');
    expect(store.getSnapshot().entries.map((e) => e.exercise_id)).toEqual([BENCH]);
  });

  it('refuses with no run, and with a run that has no next session', async () => {
    await expect(startProgramSession(db, USER, 'lb', storeOptions())).rejects.toMatchObject({ reason: 'no-run' });
    const p = await createProgram(db, USER, 'P', opts);
    const week = await addWeek(db, USER, p.id, opts);
    const day = await addProgramWorkout(db, USER, week.id, null, opts);
    await startProgramRun(db, USER, p.id, opts);
    await db.runAsync('update program_workouts set deleted_at = ? where id = ?', [T0, day.id]);
    await expect(startProgramSession(db, USER, 'lb', storeOptions())).rejects.toBeInstanceOf(ProgramRunError);
    expect(currentSessionWorkout(USER)).toBeNull();
  });

  it('refuses to link a workout to a program workout the phone does not hold', async () => {
    await expect(
      startActiveWorkout(db, USER, { ...storeOptions(), programWorkoutId: 'b0000000-0000-4000-8000-999999999999' }),
    ).rejects.toThrow(/not on this phone/);
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 0 });
  });

  it('cuts a long title to the 100-character limit, counting the way the server does', () => {
    expect(programSessionTitle('Short', 'Week 1 · Day A')).toBe('Short — Week 1 · Day A');
    const title = programSessionTitle('💪'.repeat(100), 'Week 1 · Day A');
    expect(Array.from(title)).toHaveLength(100);
    expect(title.endsWith('…')).toBe(true);
  });
});

/** Wraps a driver so the next statement inside a transaction matching `pattern` throws (once). */
function faultyDriver(inner: SqlDriver): SqlDriver & { failNext(pattern: RegExp): void } {
  let pattern: RegExp | null = null;
  const wrap = (tx: SqlExecutor): SqlExecutor => ({
    execAsync: (sql) => tx.execAsync(sql),
    runAsync: async (sql, params) => {
      if (pattern && pattern.test(sql)) {
        pattern = null;
        throw new Error('simulated failure mid-transaction');
      }
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

describe('finish advances the run atomically', () => {
  it('a finish that fails while saving the run leaves the workout unfinished and the run unmoved', async () => {
    const faulty = faultyDriver(db);
    db = faulty;
    const programId = await strengthBlock();
    const run = await startProgramRun(db, USER, programId, opts);
    const store = await startProgramSession(db, USER, 'lb', storeOptions());
    await store.logSet(store.getSnapshot().entries[0].id, { reps: 5 });

    faulty.failNext(/insert into program_runs/);
    await expect(store.finish()).rejects.toThrow('simulated failure');
    const [workout] = await getRowsByIds(db, 'workouts', [store.getSnapshot().workout.id]);
    expect(workout.ended_at).toBeNull();
    expect((await readActiveRun(db, USER))?.run).toEqual(run);

    // The retry succeeds and moves both together.
    await store.finish();
    expect((await readActiveRun(db, USER))?.nextSession?.workout.label).toBe('Day B');
  });
});

describe('offline end to end', () => {
  it('author a program, run a session, reconnect once: every row lands and a second phone agrees', async () => {
    const server = new FakeServer();
    server.offline = true;
    const programId = await strengthBlock();
    await startProgramRun(db, USER, programId, opts);
    const store = await startProgramSession(db, USER, 'lb', storeOptions());
    await store.logSet(store.getSnapshot().entries[0].id, { reps: 5, weight: { value: 225, unit: 'lb' } });
    await store.finish();
    await expect(pushOutbox(db, server)).rejects.toThrow();

    server.offline = false;
    // One push: the linked workout must not reach the server before the program workout it names
    // (the fake, like the real server, refuses that — which would block the queue for good).
    await pushOutbox(db, server);
    const workoutId = store.getSnapshot().workout.id;
    expect(server.tables.workouts.get(workoutId)?.program_workout_id).toBe(store.getSnapshot().workout.program_workout_id);
    expect([...server.tables.program_runs.values()]).toHaveLength(1);
    expect(await db.getFirstAsync('select count(*) as n from outbox')).toEqual({ n: 0 });

    const phone2 = await prepareDatabase(createNodeSqliteDriver());
    await pullChanges(phone2, server, USER);
    const active = await readActiveRun(phone2, USER);
    expect(active?.nextSession?.workout.label).toBe('Day B');
    expect(await phone2.getFirstAsync('select program_workout_id from workouts where id = ?', [workoutId])).toEqual({
      program_workout_id: store.getSnapshot().workout.program_workout_id,
    });
  });
});
