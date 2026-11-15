/**
 * The B09 definition of done, walked end to end through the real screens, the real
 * active-workout store and real SQLite:
 *
 *   Workout tab → Start empty workout → logger → add two exercises by search → log sets in
 *   pounds → repeat a set with ONE press → Finish → saved workout shows every set intact →
 *   nothing is left in progress.
 *
 * Plus B10's set types through the same screens (a reps-only pull-up, a warm-up, an RPE), and
 * the logger's two exits that don't save: finishing with nothing logged (offered only
 * "Discard workout" / "Keep lifting") and Discard. The router is a stub, so each screen is
 * rendered in turn the way navigation would show it; the database is handed in through a
 * mocked `openAppDatabase`. Sync is proven in B07/B08 and not re-tested here.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';
import { loadActiveWorkout, startActiveWorkout } from '@/workout/activeWorkout';
import { clearSessionWorkout, currentSessionWorkout } from '@/workout/activeWorkoutSession';
import { readWorkout } from '@/workout/history';

import WorkoutScreen from '@/app/(tabs)/workout';
import ActiveWorkoutScreen from '@/app/active-workout';
import SavedWorkoutScreen from '@/app/workout/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

afterEach(() => {
  clearSessionWorkout();
  jest.restoreAllMocks();
});

/** Opens the Add-exercise panel, searches, and taps the exercise. */
async function addExercise(search: string, name: string): Promise<void> {
  await fireEvent.press(screen.getByLabelText('Add exercise'));
  await fireEvent.changeText(screen.getByLabelText('Search exercises'), search);
  await fireEvent.press(screen.getByLabelText(`Add ${name}`));
  await screen.findByLabelText(`Reps for ${name}`);
}

/** Types reps and weight (lb) into an exercise's card and taps Log set. */
async function logSet(name: string, reps: string, weight: string, setNumber: number): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(`Reps for ${name}`), reps);
  await fireEvent.changeText(screen.getByLabelText(`Weight in lb for ${name}`), weight);
  const logButtons = screen.getAllByLabelText('Log set');
  const cardIndex = name === 'Bench Press' ? 0 : 1;
  await fireEvent.press(logButtons[cardIndex]);
  await screen.findByLabelText(`Remove set ${setNumber} of ${name}`);
}

describe('logger flow (B09 definition of done)', () => {
  it('logs a multi-exercise session, saves it and reopens it with every set intact', async () => {
    // 1. The Workout tab starts a blank workout.
    const tab = await renderSignedIn(<WorkoutScreen />);
    await screen.findByText('Finished workouts show up here.');
    await fireEvent.press(screen.getByLabelText('Start empty workout'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/active-workout'));
    await tab.unmount();

    // 2. The logger: two exercises from the library, sets in pounds, one-tap repeat.
    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByText('No exercises yet. Add the first one to start logging.');
    await addExercise('bench press', 'Bench Press');
    await logSet('Bench Press', '5', '225', 1);
    const [repeatBench] = screen.getAllByLabelText('Repeat last set');
    await fireEvent.press(repeatBench); // NFR-2: exactly one tap
    await screen.findByLabelText('Remove set 2 of Bench Press');

    await addExercise('squats', 'Squat');
    await logSet('Squat', '3', '315', 1);
    await logSet('Squat', '2', '335', 2);

    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [[target]] = mockRouter.replace.mock.calls as [[{ pathname: string; params: { id: string } }]];
    expect(target.pathname).toBe('/workout/[id]');
    // Finishing replaced the logger; it did not also try to go "back".
    expect(mockRouter.back).not.toHaveBeenCalled();
    await screen.unmount();

    // 3. Finish opened the saved workout: every set, as logged.
    mockParams = { id: target.params.id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Bench Press');
    expect(screen.getAllByText('5 × 225 lb')).toHaveLength(2);
    expect(screen.getByText('Squat')).toBeTruthy();
    expect(screen.getByText('3 × 315 lb')).toBeTruthy();
    expect(screen.getByText('2 × 335 lb')).toBeTruthy();
    expect(screen.getByText(/2 exercises · 4 sets$/)).toBeTruthy();

    // The database agrees, and nothing is left in progress.
    const saved = await readWorkout(db, SIGNED_IN_USER_ID, target.params.id);
    expect(saved?.entries.map((e) => [e.exerciseName, e.sets.map((s) => s.reps)])).toEqual([
      ['Bench Press', [5, 5]],
      ['Squat', [3, 2]],
    ]);
    expect(saved?.entries[0].sets[0].weight_kg).toBe(saved?.entries[0].sets[1].weight_kg);
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).toBeNull();
    expect(currentSessionWorkout(SIGNED_IN_USER_ID)).toBeNull();
  });

  it('B10: a pull-up logged with reps only, a warm-up and an RPE survive finish to the saved workout', async () => {
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);

    // A warm-up, then a work set with an RPE, on bench.
    await addExercise('bench press', 'Bench Press');
    await fireEvent.press(screen.getByLabelText('Warm-up sets for Bench Press'));
    await logSet('Bench Press', '10', '95', 1);
    await fireEvent.press(screen.getByLabelText('Warm-up sets for Bench Press'));
    await fireEvent.changeText(screen.getByLabelText('RPE for Bench Press'), '8');
    await logSet('Bench Press', '5', '225', 2);

    // A pull-up: reps only, nothing in the weight box (LOG-15).
    await addExercise('pullups', 'Pullups');
    await fireEvent.changeText(screen.getByLabelText('Reps for Pullups'), '8');
    await fireEvent.press(screen.getAllByLabelText('Log set')[1]);
    await screen.findByLabelText('Remove set 1 of Pullups');

    await fireEvent.press(screen.getByLabelText('Finish'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const [[target]] = mockRouter.replace.mock.calls as [[{ params: { id: string } }]];
    await screen.unmount();

    mockParams = { id: target.params.id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('Pullups');
    expect(screen.getByText('W · 10 × 95 lb')).toBeTruthy();
    expect(screen.getByText('5 × 225 lb @ RPE 8')).toBeTruthy();
    expect(screen.getByText('8 reps')).toBeTruthy();

    const saved = await readWorkout(db, SIGNED_IN_USER_ID, target.params.id);
    expect(saved?.entries.map((e) => e.sets.map((s) => [s.reps, s.weight_kg === null, s.rpe, s.is_warmup]))).toEqual([
      [
        [10, false, null, true],
        [5, false, 8, false],
      ],
      [[8, true, null, false]],
    ]);
  });

  it('finishing with no sets offers only Discard workout or Keep lifting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);
    await addExercise('deadlift', 'Deadlift'); // an exercise alone isn't something logged
    await fireEvent.press(screen.getByLabelText('Finish'));

    expect(alert.mock.calls[0][0]).toBe('Nothing logged yet');
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(buttons.map((b) => b.text)).toEqual(['Keep lifting', 'Discard workout']);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    buttons.find((b) => b.text === 'Discard workout')?.onPress?.();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).toBeNull();
  });

  it('Discard asks first, then deletes the workout and leaves', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);
    await addExercise('bench press', 'Bench Press');
    await logSet('Bench Press', '5', '135', 1);
    await fireEvent.press(screen.getByLabelText('Discard'));
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).not.toBeNull(); // only asked so far

    (alert.mock.calls[0][2] as AlertButton[]).find((b) => b.text === 'Discard workout')?.onPress?.();
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).toBeNull();
  });

  it('opened with nothing in progress, the logger goes back', async () => {
    await renderSignedIn(<ActiveWorkoutScreen />);
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  });
});
