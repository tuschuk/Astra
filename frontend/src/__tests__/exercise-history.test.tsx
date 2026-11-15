/**
 * Tests for the per-exercise history screen (LOG-4): the exercise's current PRs on top, then
 * every finished session of it, newest first, with its sets — only the signed-in lifter's, never
 * a workout still in progress. Real SQLite through a mocked `openAppDatabase`; the router is a
 * stub. (Lives in `__tests__/` because expo-router would treat a test under `app/` as a route.)
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, lb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { OTHER_USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout, type SetInput } from '@/workout/activeWorkout';
import { workoutDateLabel } from '@/workout/format';
import { EXERCISE_SESSION_LIMIT } from '@/workout/history';

import ExerciseHistoryScreen from '@/app/exercise-history/[exerciseId]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { exerciseId?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

/** Logs one workout of `exerciseId` sets starting at `start`; finished unless told otherwise. */
async function logWorkout(
  start: string,
  sets: SetInput[],
  { userId = SIGNED_IN_USER_ID, finish = true, title }: { userId?: string; finish?: boolean; title?: string } = {},
) {
  const store = await startActiveWorkout(db, userId, steadyOptions(start));
  const bench = await store.addExercise(BENCH);
  const squat = await store.addExercise(SQUAT);
  for (const input of sets) await store.logSet(bench.id, input);
  await store.logSet(squat.id, lb(5, 315));
  if (title) await store.setTitle(title);
  if (finish) await store.finish();
}

describe('Exercise history screen', () => {
  it('shows the current PRs, then every finished session newest first with its sets', async () => {
    await logWorkout('2026-11-08T12:00:00.000Z', [lb(10, 95, { isWarmup: true }), lb(5, 205), lb(5, 205)]);
    await logWorkout('2026-11-12T12:00:00.000Z', [lb(1, 245), lb(8, 225), lb(8, 185, { dropSetPosition: 1 })], {
      title: 'Heavy day',
    });
    await logWorkout('2026-11-13T12:00:00.000Z', [lb(1, 999)], { userId: OTHER_USER_ID });
    await logWorkout('2026-11-14T12:00:00.000Z', [lb(1, 500)], { finish: false });
    mockParams = { exerciseId: BENCH };

    await renderSignedIn(<ExerciseHistoryScreen />);
    expect(await screen.findByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('Current PRs')).toBeTruthy();
    // 8 × 225 lb → e1RM 285 lb beats the 245 single; nobody else's 999 and no in-progress 500.
    expect(screen.getByText('1RM 245 lb · e1RM 285 lb · 5RM 205 lb · 8RM 225 lb')).toBeTruthy();

    // Newest first: the titled session (with its date under it), then the older one by date.
    const olderDate = workoutDateLabel('2026-11-08T12:00:00.000Z');
    const headings = screen
      .getAllByText(new RegExp(`^(Heavy day|${olderDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})$`))
      .map((n) => n.props.children);
    expect(headings).toEqual(['Heavy day', olderDate]);
    expect(screen.getByText(workoutDateLabel('2026-11-12T12:00:00.000Z'))).toBeTruthy();
    // Sets as the saved workout prints them: warm-up marked, the drop set on one row.
    expect(screen.getByText('1 × 245 lb')).toBeTruthy();
    expect(screen.getByText('8 × 225 lb → 8 × 185 lb')).toBeTruthy();
    expect(screen.getByText('W · 10 × 95 lb')).toBeTruthy();
    expect(screen.getAllByText('5 × 205 lb')).toHaveLength(2);
    // Only bench: the squat sets of the same workouts are not listed.
    expect(screen.queryByText('5 × 315 lb')).toBeNull();
    expect(screen.queryByText('1 × 999 lb')).toBeNull();
    expect(screen.queryByText('1 × 500 lb')).toBeNull();
  });

  it('says so when the exercise has no sessions or PRs yet', async () => {
    mockParams = { exerciseId: BENCH };
    await renderSignedIn(<ExerciseHistoryScreen />);
    expect(await screen.findByText('No PRs yet')).toBeTruthy();
    expect(screen.getByText('No finished sessions of this exercise yet.')).toBeTruthy();
  });

  it('lists the newest 50 sessions, and "Show older sessions" reaches the rest (B30)', async () => {
    // 51 sessions, one a day from Sep 1, each a single heavier than the last; the oldest is 100 lb.
    const start = Date.parse('2026-09-01T12:00:00.000Z');
    for (let i = 0; i < EXERCISE_SESSION_LIMIT + 1; i++) {
      await logWorkout(new Date(start + i * 86_400_000).toISOString(), [lb(1, 100 + i)]);
    }
    mockParams = { exerciseId: BENCH };
    await renderSignedIn(<ExerciseHistoryScreen />);
    expect(await screen.findByText(`1 × ${100 + EXERCISE_SESSION_LIMIT} lb`)).toBeTruthy();
    expect(screen.queryByText('1 × 100 lb')).toBeNull();

    await fireEvent.press(screen.getByText('Show older sessions'));
    expect(await screen.findByText('1 × 100 lb')).toBeTruthy();
    expect(screen.queryByText('Show older sessions')).toBeNull();
  });

  it('Back returns to where it was opened from', async () => {
    mockParams = { exerciseId: BENCH };
    await renderSignedIn(<ExerciseHistoryScreen />);
    await screen.findByText('No PRs yet');
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
