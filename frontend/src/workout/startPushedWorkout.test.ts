/**
 * Tests for starting a workout a coach pushed to the team (B37), on real SQLite: the logger opens
 * on a new workout titled "<program> — <workout>", the slots' exercises added in order with their
 * targets as notes in the lifter's unit, no sets invented, no program link (so no run moves); a
 * slot this phone can't log is skipped and counted; and a second start is refused while a
 * workout is unfinished.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import type { TeamWorkoutPayload } from '@/social/teamCoaching';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { clearSessionWorkout, currentSessionWorkout } from './activeWorkoutSession';
import { startPushedWorkout } from './startPushedWorkout';

const USER = 'a0000000-0000-4000-8000-000000000001';
const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');

let db: SqlDriver;

beforeEach(async () => {
  db = await prepareDatabase(createNodeSqliteDriver());
});

afterEach(() => clearSessionWorkout());

const payload: TeamWorkoutPayload = {
  name: 'Day A',
  position: 0,
  programName: 'Coach Block',
  exercises: [
    { exerciseId: SQUAT, exerciseName: 'Squat', position: 0, targetSets: 3, targetReps: 5, targetWeightKg: 100, targetRpe: 8 },
    { exerciseId: 'c0000000-0000-4000-8000-0000000000ff', exerciseName: 'Coach Sled', position: 1, targetSets: 2, targetReps: null, targetWeightKg: null, targetRpe: null },
    { exerciseId: BENCH, exerciseName: 'Bench Press', position: 2, targetSets: 3, targetReps: 8, targetWeightKg: null, targetRpe: null },
  ],
};

describe('startPushedWorkout', () => {
  it('opens a prefilled, unlinked workout and skips what this phone can’t log', async () => {
    const { store, skippedExercises } = await startPushedWorkout(db, USER, payload, 'kg');
    expect(currentSessionWorkout(USER)).toBe(store);
    const snap = store.getSnapshot();
    expect(snap.workout.title).toBe('Coach Block — Day A');
    expect(snap.workout.program_workout_id).toBeNull();
    expect(snap.entries.map((e) => e.exercise_id)).toEqual([SQUAT, BENCH]);
    expect(snap.entries.map((e) => e.notes)).toEqual(['Target: 3 × 5 @ 100 kg · RPE 8', 'Target: 3 × 8']);
    expect(snap.entries.every((e) => e.sets.length === 0)).toBe(true);
    expect(skippedExercises).toBe(1);
  });

  it('refuses while another workout is unfinished', async () => {
    await startPushedWorkout(db, USER, payload, 'kg');
    await expect(startPushedWorkout(db, USER, payload, 'kg')).rejects.toThrow();
  });
});
