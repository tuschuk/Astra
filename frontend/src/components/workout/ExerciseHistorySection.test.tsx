/**
 * Tests for ExerciseHistorySection (LOG-4, LIB-4) — the one reader and renderer of a lifter's
 * records and history for an exercise. History is written through the real active-workout store's
 * `finish()`, so the PR rows asserted here are what B13 actually saves, not hand-made fixtures.
 * Real SQLite through a mocked `openAppDatabase`; never the real Supabase project.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { DEFAULT_DISPLAY_UNIT } from '@/settings/displayUnit';
import { createPreparedDb, lb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { startActiveWorkout, type SetInput } from '@/workout/activeWorkout';
import { formatPrLine, workoutDateLabel } from '@/workout/format';
import { currentPrs } from '@/workout/prs';

import { ExerciseHistorySection } from './ExerciseHistorySection';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const BENCH = libraryExerciseId('bench_press');
let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** Logs and finishes one bench workout starting at `start`. */
async function logBench(start: string, sets: SetInput[], title?: string) {
  const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(start));
  const bench = await store.addExercise(BENCH);
  for (const input of sets) await store.logSet(bench.id, input);
  if (title) await store.setTitle(title);
  await store.finish();
}

/**
 * Hands the section a copy of the test database whose list reads can be switched to fail (as if
 * the phone's storage stopped answering), and returns the switch.
 */
function failableReads(): { failing: boolean } {
  const reads = { failing: false };
  const flaky: SqlDriver = {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params) => db.runAsync(sql, params),
    getFirstAsync: (sql, params) => db.getFirstAsync(sql, params),
    getAllAsync: <T,>(sql: string, params?: Parameters<SqlDriver['getAllAsync']>[1]) =>
      reads.failing ? Promise.reject(new Error('disk gone')) : db.getAllAsync<T>(sql, params),
    withTransactionAsync: (task) => db.withTransactionAsync(task),
  };
  mockOpenDatabase.mockResolvedValue(flaky);
  return reads;
}

/** ISO start time of the n-th day of November 2026, noon UTC. */
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}T12:00:00.000Z`;

describe('ExerciseHistorySection', () => {
  it('shows exactly the PR line B13 saved, then each session with its sets', async () => {
    await logBench(day(8), [lb(10, 95, { isWarmup: true }), lb(5, 205)]);
    await logBench(day(12), [lb(8, 225), lb(8, 185, { dropSetPosition: 1 })], 'Heavy day');

    await renderSignedIn(<ExerciseHistorySection exerciseId={BENCH} />);
    const expected = formatPrLine(await currentPrs(db, SIGNED_IN_USER_ID, BENCH), DEFAULT_DISPLAY_UNIT);
    expect(expected).not.toBe('');
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.getByText('Heavy day')).toBeTruthy();
    expect(screen.getByText(workoutDateLabel(day(8)))).toBeTruthy();
    expect(screen.getByText('8 × 225 lb → 8 × 185 lb')).toBeTruthy();
    expect(screen.getByText('W · 10 × 95 lb')).toBeTruthy();
    // No heading unless asked for, and no show-more for a short history.
    expect(screen.queryByText('Bench Press')).toBeNull();
    expect(screen.queryByText('Show older sessions')).toBeNull();
  });

  it('draws the exercise name as a heading when asked', async () => {
    await renderSignedIn(<ExerciseHistorySection exerciseId={BENCH} showName />);
    expect(await screen.findByText('Bench Press')).toBeTruthy();
  });

  it('says so when nothing is logged yet', async () => {
    await renderSignedIn(<ExerciseHistorySection exerciseId={BENCH} />);
    expect(await screen.findByText('No PRs yet')).toBeTruthy();
    expect(screen.getByText('No finished sessions of this exercise yet.')).toBeTruthy();
  });

  it('shows the failure line when the database read fails', async () => {
    const reads = failableReads();
    reads.failing = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderSignedIn(<ExerciseHistorySection exerciseId={BENCH} />);
    expect(await screen.findByText('This exercise’s history couldn’t be read.')).toBeTruthy();
    warn.mockRestore();
  });

  it('keeps the shown list when only the "older sessions" read fails', async () => {
    await logBench(day(1), [lb(3, 135)]);
    await logBench(day(2), [lb(3, 145)]);
    const reads = failableReads();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await renderSignedIn(<ExerciseHistorySection exerciseId={BENCH} pageSize={1} />);
    expect(await screen.findByText('3 × 145 lb')).toBeTruthy();
    reads.failing = true;
    await fireEvent.press(screen.getByText('Show older sessions'));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.getByText('3 × 145 lb')).toBeTruthy();
    expect(screen.queryByText('This exercise’s history couldn’t be read.')).toBeNull();
    warn.mockRestore();
  });

  it('shows the failure line when the database cannot be opened', async () => {
    mockOpenDatabase.mockRejectedValue(new Error('cannot open'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await renderSignedIn(<ExerciseHistorySection exerciseId={BENCH} />);
    expect(await screen.findByText('This exercise’s history couldn’t be read.')).toBeTruthy();
    warn.mockRestore();
  });

  it('"Show older sessions" reveals the rest of a long history, then disappears', async () => {
    await logBench(day(1), [lb(3, 135)]);
    await logBench(day(2), [lb(3, 145)]);
    await logBench(day(3), [lb(3, 155)]);

    await renderSignedIn(<ExerciseHistorySection exerciseId={BENCH} pageSize={2} />);
    expect(await screen.findByText('3 × 155 lb')).toBeTruthy();
    expect(screen.getByText('3 × 145 lb')).toBeTruthy();
    expect(screen.queryByText('3 × 135 lb')).toBeNull();

    await fireEvent.press(screen.getByText('Show older sessions'));
    expect(await screen.findByText('3 × 135 lb')).toBeTruthy();
    // The newer sessions stayed on screen, and three sessions under a limit of four ends the list.
    expect(screen.getByText('3 × 155 lb')).toBeTruthy();
    expect(screen.queryByText('Show older sessions')).toBeNull();
  });
});
