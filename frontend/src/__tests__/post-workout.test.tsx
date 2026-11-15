/**
 * B21's definition of done, walked through the real screens, the real stores and real SQLite:
 *
 *   logger → Finish → the analysis in finish mode → Next → the Post step → Post (a post of that
 *   workout, with the chosen flair, queued and then on the stand-in server exactly once) or
 *   Skip (nothing made, back to the Workout tab).
 *
 * Plus the Post step's guard states (not on this phone, already posted, no flairs synced yet) and
 * that only a fresh finish offers the flow. The router is a stub, so each screen is rendered in
 * turn the way navigation would show it; the database is handed in through a mocked
 * `openAppDatabase`. Route files live in `src/app/`, so their tests live here (expo-router would
 * register a test file beside them as a route).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { FlairRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { replaceFlairsTx } from '@/db/flairs';
import { libraryExerciseId } from '@/library/uuidv5';
import { createWorkoutPost } from '@/social/createPost';
import { pendingRows, outboxSize } from '@/sync/outbox';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { clearSessionWorkout } from '@/workout/activeWorkoutSession';

import ActiveWorkoutScreen from '@/app/active-workout';
import AnalysisScreen from '@/app/analysis/[id]';
import PostWorkoutScreen from '@/app/post-workout/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { id?: string; post?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

/**
 * The flair list as the server might hold it. "Leg Day Legends" is a name no app code mentions —
 * seeing it as a chip proves the chips come from the rows, not from words in the app (SOC-3).
 */
const FLAIRS: FlairRow[] = [
  { id: 'wod', name: 'WOD', position: 1, upvotes_only: false },
  { id: 'leg-day-legends', name: 'Leg Day Legends', position: 2, upvotes_only: false },
];

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
  await db.withTransactionAsync((tx) => replaceFlairsTx(tx, FLAIRS));
});

afterEach(() => {
  clearSessionWorkout();
});

/** Starts a workout with one squat set logged, leaving it in progress for the logger to resume. */
async function workoutInProgress(start = '2026-11-15T09:00:00.000Z'): Promise<void> {
  const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(start));
  const squat = await store.addExercise(libraryExerciseId('squat'));
  await store.logSet(squat.id, { reps: 5, weight: { value: 225, unit: 'lb' } });
}

/** A finished workout straight from the store (no screens); returns its id. */
async function finishedWorkout(start = '2026-11-15T09:00:00.000Z'): Promise<string> {
  const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(start));
  const squat = await store.addExercise(libraryExerciseId('squat'));
  await store.logSet(squat.id, { reps: 5, weight: { value: 225, unit: 'lb' } });
  return (await store.finish()).id;
}

/** Renders the logger on the workout in progress, taps Finish, and returns where it navigated. */
async function finishInLogger(): Promise<{ pathname: string; params: { id: string; post?: string } }> {
  const view = await renderSignedIn(<ActiveWorkoutScreen />);
  await screen.findByText('Squat');
  await fireEvent.press(screen.getByLabelText('Finish'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  const target = mockRouter.replace.mock.calls.at(-1)![0] as { pathname: string; params: { id: string; post?: string } };
  await view.unmount();
  return target;
}

/** The analysis in finish mode → Next; returns where Next navigated. */
async function nextFromAnalysis(id: string): Promise<{ pathname: string; params: { id: string } }> {
  mockParams = { id, post: '1' };
  const view = await renderSignedIn(<AnalysisScreen />);
  await fireEvent.press(await screen.findByLabelText('Next'));
  const target = mockRouter.push.mock.calls.at(-1)![0] as { pathname: string; params: { id: string } };
  await view.unmount();
  return target;
}

async function postCount(): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('select count(*) as n from posts'))!.n;
}

describe('finish → analysis → Post step (B21 definition of done)', () => {
  it('always runs after Finish: the analysis opens in finish mode, and Next opens the Post step with the flairs from the rows', async () => {
    await workoutInProgress();
    const toAnalysis = await finishInLogger();
    expect(toAnalysis).toEqual({ pathname: '/analysis/[id]', params: { id: expect.any(String), post: '1' } });

    const toPost = await nextFromAnalysis(toAnalysis.params.id);
    expect(toPost).toEqual({ pathname: '/post-workout/[id]', params: { id: toAnalysis.params.id } });

    mockParams = { id: toPost.params.id };
    await renderSignedIn(<PostWorkoutScreen />);
    expect(await screen.findByText('Share your workout')).toBeTruthy();
    expect(screen.getByText('Leg Day Legends')).toBeTruthy();
    // The lowest-position flair starts picked.
    expect(screen.getByRole('radio', { name: 'WOD' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('radio', { name: 'Leg Day Legends' }).props.accessibilityState).toMatchObject({
      selected: false,
    });
    expect(screen.getByLabelText('Skip')).toBeTruthy();
  });

  it('Post makes one post of that workout with the picked flair, queued, then on the server exactly once; lands on Home', async () => {
    const id = await finishedWorkout();
    mockParams = { id };
    await renderSignedIn(<PostWorkoutScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Leg Day Legends' }));
    expect(screen.getByRole('radio', { name: 'Leg Day Legends' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByLabelText('Post'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));

    const rows = await db.getAllAsync<{ workout_id: string; flair_id: string; user_id: string }>(
      'select workout_id, flair_id, user_id from posts',
    );
    // The workout id is also its analysis's id — one id links both.
    expect(rows).toEqual([{ workout_id: id, flair_id: 'leg-day-legends', user_id: SIGNED_IN_USER_ID }]);
    expect(await pendingRows(db, 'posts')).toHaveLength(1);

    // Offline nothing leaves; the next connection uploads it after its workout, once.
    const server = new FakeServer();
    server.flairs.push({ id: 'leg-day-legends', name: 'Leg Day Legends', position: 9, upvotes_only: false });
    server.offline = true;
    await expect(pushOutbox(db, server)).rejects.toThrow();
    server.offline = false;
    await pushOutbox(db, server);
    await pushOutbox(db, server);
    expect([...server.posts.values()].map((p) => [p.workout_id, p.flair_id])).toEqual([[id, 'leg-day-legends']]);
    expect(await outboxSize(db)).toBe(0);
  });

  it('can be skipped at the Post step: no post, no outbox line, back to the Workout tab — and the next finish offers it again', async () => {
    const id = await finishedWorkout();
    const linesBefore = await outboxSize(db);
    mockParams = { id };
    const view = await renderSignedIn(<PostWorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Skip'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/workout');
    expect(await postCount()).toBe(0);
    expect(await outboxSize(db)).toBe(linesBefore);
    expect(await pendingRows(db, 'posts')).toEqual([]);
    await view.unmount();

    await workoutInProgress('2026-11-15T12:00:00.000Z');
    const again = await finishInLogger();
    expect(again.params).toEqual({ id: expect.not.stringMatching(id), post: '1' });
    expect((await nextFromAnalysis(again.params.id)).pathname).toBe('/post-workout/[id]');
  });

  it('Back returns to the analysis', async () => {
    mockParams = { id: await finishedWorkout() };
    await renderSignedIn(<PostWorkoutScreen />);
    await screen.findByText('Share your workout');
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('only a fresh finish offers the flow', () => {
  it('the analysis opened from a saved workout (no post=1) has no Next', async () => {
    mockParams = { id: await finishedWorkout() };
    await renderSignedIn(<AnalysisScreen />);
    expect(await screen.findByLabelText('View workout')).toBeTruthy();
    expect(screen.queryByLabelText('Next')).toBeNull();
  });
});

describe('Post step guard states', () => {
  it('an already-posted workout shows "Already posted" with a way Home, and offers no second post', async () => {
    const id = await finishedWorkout();
    await createWorkoutPost(db, SIGNED_IN_USER_ID, id, 'wod');
    mockParams = { id };
    await renderSignedIn(<PostWorkoutScreen />);
    expect(await screen.findByText('Already posted')).toBeTruthy();
    expect(screen.queryByLabelText('Post')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Go to Home'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('a missing, unfinished or other user’s workout shows "isn’t on this phone"', async () => {
    mockParams = { id: 'missing' };
    const missing = await renderSignedIn(<PostWorkoutScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
    await missing.unmount();

    const draft = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions());
    mockParams = { id: draft.getSnapshot().workout.id };
    const unfinished = await renderSignedIn(<PostWorkoutScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
    await unfinished.unmount();
    await draft.discard();

    const other = await startActiveWorkout(db, '22222222-2222-4222-8222-222222222222', steadyOptions());
    mockParams = { id: (await other.finish()).id };
    await renderSignedIn(<PostWorkoutScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
  });

  it('with no flairs synced yet, Post is disabled with a line saying why — and Skip still works', async () => {
    await db.runAsync('delete from flairs');
    mockParams = { id: await finishedWorkout() };
    await renderSignedIn(<PostWorkoutScreen />);
    expect(await screen.findByText(/Flairs haven’t synced to this phone yet/)).toBeTruthy();
    expect(screen.getByLabelText('Post').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText('Skip'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/workout');
    expect(await postCount()).toBe(0);
  });

  it('a post made elsewhere while the screen was open turns Post into "Already posted", not an error', async () => {
    const id = await finishedWorkout();
    mockParams = { id };
    await renderSignedIn(<PostWorkoutScreen />);
    await screen.findByText('Share your workout');
    await createWorkoutPost(db, SIGNED_IN_USER_ID, id, 'wod');
    await fireEvent.press(screen.getByLabelText('Post'));
    expect(await screen.findByText('Already posted')).toBeTruthy();
    expect(await postCount()).toBe(1);
  });
});
