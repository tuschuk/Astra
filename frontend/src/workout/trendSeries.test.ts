/**
 * Tests for the profile trend series (B46), on real SQLite (Node's built-in engine) with workouts
 * logged through the real active-workout store — the "render from logged data" half of the step's
 * definition of done, pinned to hand-worked numbers:
 *   - volume: one point per finished session, oldest first, through `sessionVolumeKg`; warm-up-only
 *     and bodyweight sessions kept at 0; an empty finish, an unfinished draft and another user's
 *     workouts left out; mixed "Z" / "+00:00" timestamps ordered by instant, not by text;
 *   - e1RM: the best Epley estimate per session (more reps can beat more weight), no point for a
 *     session with nothing qualifying (warm-ups, bodyweight, 31 reps);
 *   - the picker: only exercises with a qualifying set, newest first, names resolved, a deleted
 *     custom still offered;
 *   - the window cut, including a month-end date.
 */
import { describe, expect, it } from '@jest/globals';
import { epleyE1rm } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import { createCustomExercise, deleteCustomExercise } from '@/library/customExercises';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, steadyOptions } from '@/test-utils/loggerTestKit';
import { OTHER_USER_ID, USER_ID } from '@/test-utils/workoutFixtures';

import { startActiveWorkout, type SetInput } from './activeWorkout';
import { e1rmSeries, filterWindow, trendExercises, volumeSeries, windowStartMs, type TrendPoint } from './trendSeries';

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
const PULLUP = libraryExerciseId('pullups');

/** A set of `reps` at `kg` kilograms, plus any extra fields. */
const kg = (reps: number, weight: number, extra: Partial<SetInput> = {}): SetInput => ({
  reps,
  weight: { value: weight, unit: 'kg' },
  ...extra,
});

/** Logs a workout of `[exerciseId, sets]` for `userId` at `start`; finishes it unless told not to. */
async function logWorkout(
  db: SqlDriver,
  userId: string,
  start: string,
  plan: [string, SetInput[]][],
  finish = true,
): Promise<string> {
  const store = await startActiveWorkout(db, userId, steadyOptions(start));
  for (const [exerciseId, sets] of plan) {
    const entry = await store.addExercise(exerciseId);
    for (const set of sets) await store.logSet(entry.id, set);
  }
  if (finish) await store.finish();
  return store.getSnapshot().workout.id;
}

/** The points as (workout, value) pairs, values rounded so float noise can't fail a test. */
const pairs = (points: TrendPoint[]) => points.map((p) => [p.workoutId, Math.round(p.valueKg * 1000) / 1000]);

describe('volumeSeries', () => {
  it('one point per finished session, oldest first, with warm-up-only and bodyweight sessions at 0', async () => {
    const db = await createPreparedDb();
    const heavy = await logWorkout(db, USER_ID, '2026-09-01T09:00:00.000Z', [
      [SQUAT, [kg(5, 100, { isWarmup: true }), kg(5, 140), kg(5, 140)]],
      [BENCH, [kg(8, 80)]],
    ]);
    const warmupsOnly = await logWorkout(db, USER_ID, '2026-09-03T09:00:00.000Z', [[SQUAT, [kg(5, 60, { isWarmup: true })]]]);
    const bodyweight = await logWorkout(db, USER_ID, '2026-09-05T09:00:00.000Z', [[PULLUP, [{ reps: 10 }, { reps: 8 }]]]);
    // Left out: an empty finish, an unfinished draft, someone else's workout.
    await logWorkout(db, USER_ID, '2026-09-06T09:00:00.000Z', []);
    await logWorkout(db, OTHER_USER_ID, '2026-09-07T09:00:00.000Z', [[SQUAT, [kg(5, 200)]]]);
    await logWorkout(db, USER_ID, '2026-09-08T09:00:00.000Z', [[SQUAT, [kg(5, 200)]]], false);

    const points = await volumeSeries(db, USER_ID);
    // 5×140 + 5×140 + 8×80 = 2040 (the warm-up adds nothing).
    expect(pairs(points)).toEqual([
      [heavy, 2040],
      [warmupsOnly, 0],
      [bodyweight, 0],
    ]);
    expect(points[0].startedAtMs).toBe(Date.parse('2026-09-01T09:00:00.000Z'));
  });

  it('orders sessions by their instant even when the stored spellings differ', async () => {
    const db = await createPreparedDb();
    const later = await logWorkout(db, USER_ID, '2026-09-02T09:00:00.000Z', [[SQUAT, [kg(1, 100)]]]);
    const earlier = await logWorkout(db, USER_ID, '2026-09-02T08:00:00.000Z', [[SQUAT, [kg(1, 50)]]]);
    // A pulled-from-server spelling: "+00:00" with microseconds. Its text sorts after "…Z" text of
    // the same day, but its instant (08:30) is between the two.
    const middle = await logWorkout(db, USER_ID, '2026-09-02T08:30:00.000Z', [[SQUAT, [kg(1, 75)]]]);
    await db.runAsync('update workouts set started_at = ? where id = ?', ['2026-09-02T08:30:00.123456+00:00', middle]);

    expect((await volumeSeries(db, USER_ID)).map((p) => p.workoutId)).toEqual([earlier, middle, later]);
  });

  it('is empty for a lifter with no finished workouts', async () => {
    const db = await createPreparedDb();
    expect(await volumeSeries(db, USER_ID)).toEqual([]);
  });
});

describe('e1rmSeries', () => {
  it('the best Epley estimate per session — more reps can beat more weight', async () => {
    const db = await createPreparedDb();
    const first = await logWorkout(db, USER_ID, '2026-10-01T09:00:00.000Z', [
      // 100 × 5 → 116.667 beats the heavier 105 × 3 → 115.5.
      [SQUAT, [kg(5, 100), kg(3, 105)]],
      [BENCH, [kg(5, 200)]], // another exercise never leaks in
    ]);
    const second = await logWorkout(db, USER_ID, '2026-10-08T09:00:00.000Z', [
      // A single is its own 1RM (no Epley bump); the warm-up is ignored.
      [SQUAT, [kg(1, 130, { isWarmup: true }), kg(1, 120)]],
    ]);
    // No point: only warm-ups; only 31-rep sets (past Epley's range).
    await logWorkout(db, USER_ID, '2026-10-10T09:00:00.000Z', [[SQUAT, [kg(5, 150, { isWarmup: true })]]]);
    await logWorkout(db, USER_ID, '2026-10-12T09:00:00.000Z', [[SQUAT, [kg(31, 40)]]]);
    // Same exercise twice in one session: both slots count toward that session's best.
    const twice = await logWorkout(db, USER_ID, '2026-10-15T09:00:00.000Z', [
      [SQUAT, [kg(5, 90)]],
      [BENCH, [kg(5, 60)]],
      [SQUAT, [kg(2, 125)]],
    ]);
    await logWorkout(db, OTHER_USER_ID, '2026-10-16T09:00:00.000Z', [[SQUAT, [kg(1, 300)]]]);

    expect(pairs(await e1rmSeries(db, USER_ID, SQUAT))).toEqual([
      [first, 116.667],
      [second, 120],
      [twice, Math.round(epleyE1rm(125, 2) * 1000) / 1000],
    ]);
  });

  it('a set the SQL prefilter lets through but the math refuses (fractional reps) adds no point and no picker row', async () => {
    const db = await createPreparedDb();
    const workoutId = await logWorkout(db, USER_ID, '2026-10-01T09:00:00.000Z', [[SQUAT, [kg(3, 100)]]]);
    // The app never saves this, but an odd stored row must not break anything (plan Risk 2).
    await db.runAsync(
      'update sets set reps = 2.5 where workout_exercise_id in (select id from workout_exercises where workout_id = ?)',
      [workoutId],
    );
    expect(await e1rmSeries(db, USER_ID, SQUAT)).toEqual([]);
    expect(await trendExercises(db, USER_ID)).toEqual([]);
    expect(pairs(await volumeSeries(db, USER_ID))).toEqual([[workoutId, 0]]);
  });

  it('is empty for an exercise never logged with a qualifying set', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, USER_ID, '2026-10-01T09:00:00.000Z', [[PULLUP, [{ reps: 10 }]]]);
    expect(await e1rmSeries(db, USER_ID, PULLUP)).toEqual([]);
    expect(await e1rmSeries(db, USER_ID, SQUAT)).toEqual([]);
  });
});

describe('trendExercises', () => {
  it('offers only exercises with a qualifying set, the most recently trained first', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, USER_ID, '2026-10-01T09:00:00.000Z', [
      [SQUAT, [kg(5, 100)]],
      [BENCH, [kg(5, 80)]],
    ]);
    // Bench is trained again later; squat's later session is warm-ups only, so it doesn't move.
    await logWorkout(db, USER_ID, '2026-10-05T09:00:00.000Z', [
      [BENCH, [kg(5, 82.5)]],
      [SQUAT, [kg(5, 60, { isWarmup: true })]],
    ]);
    // Never offered: bodyweight-only, 31-rep-only, an unfinished draft's exercise.
    await logWorkout(db, USER_ID, '2026-10-06T09:00:00.000Z', [[PULLUP, [{ reps: 12 }]]]);
    await logWorkout(db, USER_ID, '2026-10-07T09:00:00.000Z', [[libraryExerciseId('deadlift'), [kg(31, 60)]]]);
    await logWorkout(db, USER_ID, '2026-10-08T09:00:00.000Z', [[libraryExerciseId('barbell_row'), [kg(5, 50)]]], false);

    const offered = await trendExercises(db, USER_ID);
    expect(offered).toEqual([
      { exerciseId: BENCH, name: 'Bench Press', newestQualifyingMs: Date.parse('2026-10-05T09:00:00.000Z') },
      { exerciseId: SQUAT, name: 'Squat', newestQualifyingMs: Date.parse('2026-10-01T09:00:00.000Z') },
    ]);
  });

  it('keeps a deleted custom exercise, whose logged history is kept', async () => {
    const db = await createPreparedDb();
    const custom = await createCustomExercise(db, USER_ID, { name: 'Belt Squat', equipment: null, primaryMuscle: null });
    await logWorkout(db, USER_ID, '2026-10-01T09:00:00.000Z', [[custom.id, [kg(8, 120)]]]);
    await deleteCustomExercise(db, USER_ID, custom.id);
    const offered = await trendExercises(db, USER_ID);
    expect(offered.map((e) => e.exerciseId)).toEqual([custom.id]);
    expect(await e1rmSeries(db, USER_ID, custom.id)).toHaveLength(1);
  });

  it('never offers another user’s exercises', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, OTHER_USER_ID, '2026-10-01T09:00:00.000Z', [[SQUAT, [kg(5, 100)]]]);
    expect(await trendExercises(db, USER_ID)).toEqual([]);
  });
});

describe('filterWindow / windowStartMs', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime();
  const points: TrendPoint[] = [
    { workoutId: 'a', startedAtMs: at(2025, 0, 15), valueKg: 1 },
    { workoutId: 'b', startedAtMs: at(2026, 4, 15), valueKg: 2 },
    { workoutId: 'c', startedAtMs: at(2026, 8, 15), valueKg: 3 },
    { workoutId: 'd', startedAtMs: at(2026, 10, 10), valueKg: 4 },
  ];
  const now = at(2026, 10, 15);

  it('keeps the sessions inside the last 3 / 6 / 12 months, or all of them', () => {
    const ids = (w: Parameters<typeof filterWindow>[1]) => filterWindow(points, w, now).map((p) => p.workoutId);
    expect(ids('3m')).toEqual(['c', 'd']);
    expect(ids('6m')).toEqual(['b', 'c', 'd']);
    expect(ids('12m')).toEqual(['b', 'c', 'd']);
    expect(ids('all')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('starts a window on the same day and time, months earlier, clamped to the month’s last day', () => {
    expect(windowStartMs(3, at(2026, 10, 15))).toBe(at(2026, 7, 15));
    expect(windowStartMs(12, at(2026, 10, 15))).toBe(at(2025, 10, 15));
    // Three months before May 31 is Feb 28 — not "Feb 31", which would roll on to Mar 3.
    expect(windowStartMs(3, at(2026, 4, 31))).toBe(at(2026, 1, 28));
  });
});
