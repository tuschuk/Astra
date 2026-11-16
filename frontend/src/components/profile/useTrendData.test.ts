/**
 * Tests for useTrendData (B46), the Trends tab's state, over real SQLite: the first read picks the
 * exercise trained most recently; a pick re-reads only that exercise's e1RM history and survives a
 * reload (a re-focus); a database still opening does nothing yet; one that failed to open shows the
 * error state.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, steadyOptions } from '@/test-utils/loggerTestKit';
import { USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout } from '@/workout/activeWorkout';

import { useTrendData } from './useTrendData';

const SQUAT = libraryExerciseId('squat');
const BENCH = libraryExerciseId('bench_press');

/** Logs and finishes one workout of `[exercise, reps, kg]` sets. */
async function logWorkout(db: SqlDriver, start: string, sets: [string, number, number][]): Promise<void> {
  const store = await startActiveWorkout(db, USER_ID, steadyOptions(start));
  for (const [exerciseId, reps, kg] of sets) {
    const entry = await store.addExercise(exerciseId);
    await store.logSet(entry.id, { reps, weight: { value: kg, unit: 'kg' } });
  }
  await store.finish();
}

describe('useTrendData', () => {
  it('starts on the newest-trained exercise; a pick re-reads its e1RM and survives a reload', async () => {
    const db = await createPreparedDb();
    await logWorkout(db, '2026-10-01T12:00:00.000Z', [[BENCH, 5, 80]]);
    await logWorkout(db, '2026-10-08T12:00:00.000Z', [[SQUAT, 5, 100]]);
    const { result } = await renderHook(() => useTrendData(db, USER_ID, false));
    expect(result.current.data.status).toBe('idle');

    await act(() => result.current.reload());
    const first = result.current.data;
    expect(first.status === 'ready' && [first.exerciseId, first.e1rmFor, first.volume.length]).toEqual([SQUAT, SQUAT, 2]);

    await act(() => result.current.selectExercise(BENCH));
    const picked = result.current.data;
    expect(picked.status === 'ready' && [picked.exerciseId, picked.e1rmFor, picked.e1rm.length]).toEqual([BENCH, BENCH, 1]);

    // A newer squat session would make squat the default — the lifter's pick still wins.
    await logWorkout(db, '2026-10-15T12:00:00.000Z', [[SQUAT, 3, 110]]);
    await act(() => result.current.reload());
    const reloaded = result.current.data;
    expect(reloaded.status === 'ready' && [reloaded.exerciseId, reloaded.volume.length]).toEqual([BENCH, 3]);
  });

  it('waits while the database is still opening, and shows the error state if it failed to open', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const opening = await renderHook(() => useTrendData(null, USER_ID, false));
    await act(() => opening.result.current.reload());
    expect(opening.result.current.data.status).toBe('idle');

    const failed = await renderHook(() => useTrendData(null, USER_ID, true));
    await act(() => failed.result.current.reload());
    expect(failed.result.current.data.status).toBe('error');
    warn.mockRestore();
  });
});
