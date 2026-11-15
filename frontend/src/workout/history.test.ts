/**
 * Tests for the logger's history queries, on real SQLite (Node's built-in engine) with
 * workouts created through the real active-workout store.
 *
 * The rules pinned here are the privacy and correctness ones: only finished workouts, only the
 * signed-in user's rows, newest first, and "last time" never counts the workout being logged.
 */
import { describe, expect, it } from '@jest/globals';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, steadyOptions } from '@/test-utils/loggerTestKit';
import { OTHER_USER_ID, USER_ID } from '@/test-utils/workoutFixtures';

import { startActiveWorkout } from './activeWorkout';
import { exerciseInfo, exerciseSessions, lastSessionSets, listPastWorkouts, readWorkout } from './history';

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
const DEADLIFT = libraryExerciseId('deadlift');

/** What one exercise of a test workout should contain: its id and the reps of each set. */
type Plan = { exerciseId: string; reps: number[]; kg?: number }[];

/** Logs and finishes a workout for `userId` starting at `start`; returns its id. */
async function logWorkout(db: SqlDriver, userId: string, start: string, plan: Plan, finish = true): Promise<string> {
  const store = await startActiveWorkout(db, userId, steadyOptions(start));
  for (const { exerciseId, reps, kg = 100 } of plan) {
    const entry = await store.addExercise(exerciseId);
    for (const r of reps) await store.logSet(entry.id, { reps: r, weight: { value: kg, unit: 'kg' } });
  }
  if (finish) await store.finish();
  return store.getSnapshot().workout.id;
}

describe('listPastWorkouts', () => {
  it('lists only this user’s finished workouts, newest first, with counts', async () => {
    const db = await createPreparedDb();
    const older = await logWorkout(db, USER_ID, '2026-11-10T09:00:00.000Z', [
      { exerciseId: BENCH, reps: [5, 5] },
    ]);
    const newer = await logWorkout(db, USER_ID, '2026-11-12T09:00:00.000Z', [
      { exerciseId: BENCH, reps: [5, 5, 5] },
      { exerciseId: SQUAT, reps: [3] },
    ]);
    await logWorkout(db, OTHER_USER_ID, '2026-11-13T09:00:00.000Z', [{ exerciseId: BENCH, reps: [1] }]);
    await logWorkout(db, USER_ID, '2026-11-14T09:00:00.000Z', [{ exerciseId: BENCH, reps: [1] }], false);

    const list = await listPastWorkouts(db, USER_ID);
    expect(list.map((s) => s.workout.id)).toEqual([newer, older]);
    expect(list[0]).toMatchObject({ exerciseCount: 2, setCount: 4 });
    expect(list[1]).toMatchObject({ exerciseCount: 1, setCount: 2 });
    expect(list.every((s) => s.workout.user_id === USER_ID && s.workout.ended_at !== null)).toBe(true);
  });

  it('stops at the limit', async () => {
    const db = await createPreparedDb();
    for (let day = 1; day <= 3; day += 1) {
      await logWorkout(db, USER_ID, `2026-11-0${day}T09:00:00.000Z`, [{ exerciseId: BENCH, reps: [5] }]);
    }
    const list = await listPastWorkouts(db, USER_ID, 2);
    expect(list.map((s) => s.workout.started_at)).toEqual(['2026-11-03T09:00:00.000Z', '2026-11-02T09:00:00.000Z']);
  });
});

describe('readWorkout', () => {
  it('returns the whole finished workout with names, in logged order', async () => {
    const db = await createPreparedDb();
    const id = await logWorkout(db, USER_ID, '2026-11-12T09:00:00.000Z', [
      { exerciseId: SQUAT, reps: [5, 4, 3], kg: 140 },
      { exerciseId: BENCH, reps: [8] },
    ]);
    const saved = await readWorkout(db, USER_ID, id);
    expect(saved?.workout.id).toBe(id);
    expect(saved?.entries.map((e) => e.exerciseName)).toEqual(['Squat', 'Bench Press']);
    expect(saved?.entries[0].sets.map((s) => [s.position, s.reps, s.weight_kg])).toEqual([
      [0, 5, 140],
      [1, 4, 140],
      [2, 3, 140],
    ]);
    expect(saved?.entries[1].sets.map((s) => s.reps)).toEqual([8]);
  });

  it('refuses another user’s workout and a workout still in progress', async () => {
    const db = await createPreparedDb();
    const theirs = await logWorkout(db, OTHER_USER_ID, '2026-11-12T09:00:00.000Z', [{ exerciseId: BENCH, reps: [5] }]);
    const draft = await logWorkout(db, USER_ID, '2026-11-13T09:00:00.000Z', [{ exerciseId: BENCH, reps: [5] }], false);
    expect(await readWorkout(db, USER_ID, theirs)).toBeNull();
    expect(await readWorkout(db, USER_ID, draft)).toBeNull();
    expect(await readWorkout(db, USER_ID, 'no-such-id')).toBeNull();
  });
});

describe('lastSessionSets', () => {
  it('returns the sets from the newest finished workout with that exercise', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, USER_ID, '2026-11-08T09:00:00.000Z', [{ exerciseId: BENCH, reps: [10, 10] }]);
    const latestBench = await logWorkout(db, USER_ID, '2026-11-10T09:00:00.000Z', [
      { exerciseId: BENCH, reps: [5, 5, 3], kg: 110 },
    ]);
    // Newer, but no bench in it: does not count.
    await logWorkout(db, USER_ID, '2026-11-12T09:00:00.000Z', [{ exerciseId: SQUAT, reps: [5] }]);
    // Newer still, but someone else's: never counts.
    await logWorkout(db, OTHER_USER_ID, '2026-11-13T09:00:00.000Z', [{ exerciseId: BENCH, reps: [1] }]);
    // The workout being logged now has bench sets too — they are not "last time".
    const current = await logWorkout(db, USER_ID, '2026-11-14T09:00:00.000Z', [{ exerciseId: BENCH, reps: [2] }], false);

    const last = await lastSessionSets(db, USER_ID, BENCH, current);
    expect(last?.workoutId).toBe(latestBench);
    expect(last?.startedAt).toBe('2026-11-10T09:00:00.000Z');
    expect(last?.sets.map((s) => [s.reps, s.weight_kg])).toEqual([
      [5, 110],
      [5, 110],
      [3, 110],
    ]);
  });

  it('skips a workout where the exercise was added but no set was logged', async () => {
    const db = await createPreparedDb();
    const withSets = await logWorkout(db, USER_ID, '2026-11-08T09:00:00.000Z', [{ exerciseId: BENCH, reps: [5] }]);
    await logWorkout(db, USER_ID, '2026-11-10T09:00:00.000Z', [
      { exerciseId: BENCH, reps: [] },
      { exerciseId: SQUAT, reps: [5] },
    ]);
    expect((await lastSessionSets(db, USER_ID, BENCH, 'none'))?.workoutId).toBe(withSets);
  });

  it('joins both entries when the exercise appeared twice in that workout', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, USER_ID, '2026-11-10T09:00:00.000Z', [
      { exerciseId: BENCH, reps: [5] },
      { exerciseId: SQUAT, reps: [5] },
      { exerciseId: BENCH, reps: [12] },
    ]);
    expect((await lastSessionSets(db, USER_ID, BENCH, 'none'))?.sets.map((s) => s.reps)).toEqual([5, 12]);
  });

  it('is null for an exercise never logged', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, USER_ID, '2026-11-10T09:00:00.000Z', [{ exerciseId: BENCH, reps: [5] }]);
    expect(await lastSessionSets(db, USER_ID, DEADLIFT, 'none')).toBeNull();
  });
});

describe('exerciseInfo', () => {
  it('names library exercises with their equipment and returns null for unknown ids', async () => {
    const db = await createPreparedDb();
    expect(await exerciseInfo(db, USER_ID, BENCH)).toEqual({ name: 'Bench Press', equipment: 'Barbell' });
    expect(await exerciseInfo(db, USER_ID, libraryExerciseId('pullups'))).toEqual({
      name: 'Pullups',
      equipment: 'Bodyweight',
    });
    expect(await exerciseInfo(db, USER_ID, '00000000-0000-4000-8000-00000000dead')).toBeNull();
  });
});

describe('exerciseSessions (LOG-4 history screen)', () => {
  it('lists every finished session of the exercise, newest first, with only that exercise’s sets', async () => {
    const db = await createPreparedDb();
    const first = await logWorkout(db, USER_ID, '2026-11-08T09:00:00.000Z', [
      { exerciseId: BENCH, reps: [5, 5] },
      { exerciseId: SQUAT, reps: [3] },
    ]);
    await logWorkout(db, USER_ID, '2026-11-09T09:00:00.000Z', [{ exerciseId: SQUAT, reps: [3] }]);
    const twice = await logWorkout(db, USER_ID, '2026-11-11T09:00:00.000Z', [
      { exerciseId: BENCH, reps: [8], kg: 80 },
      { exerciseId: DEADLIFT, reps: [1] },
      { exerciseId: BENCH, reps: [6], kg: 90 },
    ]);
    await logWorkout(db, OTHER_USER_ID, '2026-11-12T09:00:00.000Z', [{ exerciseId: BENCH, reps: [1] }]);
    await logWorkout(db, USER_ID, '2026-11-13T09:00:00.000Z', [{ exerciseId: BENCH, reps: [2] }], false);

    const sessions = await exerciseSessions(db, USER_ID, BENCH);
    expect(sessions.map((s) => s.workoutId)).toEqual([twice, first]);
    // The exercise appeared twice in one workout: both slots' sets, in workout order.
    expect(sessions[0].sets.map((s) => [s.reps, s.weight_kg])).toEqual([
      [8, 80],
      [6, 90],
    ]);
    expect(sessions[1].sets.map((s) => s.reps)).toEqual([5, 5]);
    expect(sessions[1].startedAt).toBe('2026-11-08T09:00:00.000Z');
  });

  it('skips a workout where the exercise was added but no set logged, and stops at the limit', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, USER_ID, '2026-11-08T09:00:00.000Z', [{ exerciseId: BENCH, reps: [] }]);
    for (let day = 1; day <= 3; day += 1) {
      await logWorkout(db, USER_ID, `2026-11-0${day}T09:00:00.000Z`, [{ exerciseId: SQUAT, reps: [5] }]);
    }
    expect(await exerciseSessions(db, USER_ID, BENCH)).toEqual([]);
    expect(await exerciseSessions(db, USER_ID, SQUAT, 2)).toHaveLength(2);
  });
});
