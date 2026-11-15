/**
 * Tests for the edit-workout screen and the edit / delete buttons of the saved workout (B14 /
 * LOG-9), through the real screens, the real store and real SQLite. The router is a stub, so
 * each screen is rendered in turn the way navigation would show it.
 *
 * The flows: delete the workout holding a PR from the saved-workout screen and see the next
 * best set wear the badge (the step's definition of done, on screen); edit a set away on the
 * edit screen and see both the saved workout and the exercise history show the change after
 * returning; delete from the edit screen; and the refusals.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { OTHER_USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout, type SetInput } from '@/workout/activeWorkout';

import EditWorkoutScreen from '@/app/edit-workout/[id]';
import ExerciseHistoryScreen from '@/app/exercise-history/[exerciseId]';
import SavedWorkoutScreen from '@/app/workout/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: { id?: string; exerciseId?: string } = {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const SQUAT = libraryExerciseId('squat');
const lb = (reps: number, weight: number): SetInput => ({ reps, weight: { value: weight, unit: 'lb' } });

let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Finishes a one-exercise squat workout on 2026-11-`day` for `userId`; returns its id. */
async function finishSquats(day: number, sets: SetInput[], userId = SIGNED_IN_USER_ID): Promise<string> {
  const store = await startActiveWorkout(db, userId, steadyOptions(`2026-11-${day}T09:00:00.000Z`));
  const entry = await store.addExercise(SQUAT);
  for (const input of sets) await store.logSet(entry.id, input);
  await store.finish();
  return store.getSnapshot().workout.id;
}

/** Makes the next `Alert.alert` press its button named `choice`. */
function answerAlertWith(choice: string): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.text === choice)?.onPress?.();
  });
}

describe('Saved workout: Edit and Delete', () => {
  it('Delete removes the PR-holding workout; the next best set then wears the badge', async () => {
    const heavy = await finishSquats(10, [lb(5, 315)]);
    const lighter = await finishSquats(11, [lb(5, 295)]);

    // Before: the lighter workout's set holds no record.
    mockParams = { id: lighter };
    const before = await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('5 × 295 lb');
    expect(screen.queryByText(/^PR ·/)).toBeNull();
    await before.unmount();

    mockParams = { id: heavy };
    const view = await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText(/^PR · .*5RM/)).toBeTruthy();
    answerAlertWith('Delete workout');
    await fireEvent.press(screen.getByLabelText('Delete'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/workout'));
    await view.unmount();

    mockParams = { id: heavy };
    const gone = await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText('This workout isn’t on this phone.')).toBeTruthy();
    await gone.unmount();

    mockParams = { id: lighter };
    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText(/^PR · .*5RM/)).toBeTruthy();
  });

  it('“Keep it” deletes nothing', async () => {
    const id = await finishSquats(10, [lb(5, 315)]);
    mockParams = { id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('5 × 315 lb');
    answerAlertWith('Keep it');
    await fireEvent.press(screen.getByLabelText('Delete'));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 1 });
  });

  it('Edit opens the edit screen for this workout', async () => {
    const id = await finishSquats(10, [lb(5, 315)]);
    mockParams = { id };
    await renderSignedIn(<SavedWorkoutScreen />);
    await screen.findByText('5 × 315 lb');
    await fireEvent.press(screen.getByLabelText('Edit'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/edit-workout/[id]', params: { id } });
  });
});

describe('Edit workout screen', () => {
  it('a removed set is gone from the saved workout and the exercise history on return, with PRs moved', async () => {
    const id = await finishSquats(10, [lb(5, 315), lb(5, 295)]);
    mockParams = { id };
    const editor = await renderSignedIn(<EditWorkoutScreen />);
    expect(await screen.findByText('Edit workout')).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('Remove set 1 of Squat'));
    await waitFor(() => expect(screen.queryByLabelText('Remove set 2 of Squat')).toBeNull());
    await fireEvent.press(screen.getByLabelText('Done'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    await editor.unmount();

    // Back on the saved workout (it re-reads on focus): one set left, and it holds the 5RM now.
    await renderSignedIn(<SavedWorkoutScreen />);
    expect(await screen.findByText('5 × 295 lb')).toBeTruthy();
    expect(screen.queryByText('5 × 315 lb')).toBeNull();
    expect(screen.getByText(/^PR · .*5RM/)).toBeTruthy();

    // And the exercise history agrees.
    mockParams = { exerciseId: SQUAT };
    await renderSignedIn(<ExerciseHistoryScreen />);
    await waitFor(() => expect(screen.getAllByText(/295 lb/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/315 lb/)).toBeNull();
  });

  it('a title typed just before Done is saved', async () => {
    const id = await finishSquats(10, [lb(5, 315)]);
    mockParams = { id };
    await renderSignedIn(<EditWorkoutScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Workout title'), 'Heavy squats');
    await fireEvent.press(screen.getByLabelText('Done'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await db.getFirstAsync('select title from workouts')).toEqual({ title: 'Heavy squats' });
  });

  it('Delete workout deletes it and goes to the Workout tab', async () => {
    const id = await finishSquats(10, [lb(5, 315)]);
    mockParams = { id };
    await renderSignedIn(<EditWorkoutScreen />);
    await screen.findByText('Edit workout');
    answerAlertWith('Delete workout');
    await fireEvent.press(screen.getByLabelText('Delete workout'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/workout'));
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 0 });
  });

  it('refuses another user’s workout and one still in progress', async () => {
    mockParams = { id: await finishSquats(10, [lb(5, 315)], OTHER_USER_ID) };
    const first = await renderSignedIn(<EditWorkoutScreen />);
    expect(await screen.findByText('This workout can’t be edited on this phone.')).toBeTruthy();
    await first.unmount();

    const draft = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions());
    mockParams = { id: draft.getSnapshot().workout.id };
    await renderSignedIn(<EditWorkoutScreen />);
    expect(await screen.findByText('This workout can’t be edited on this phone.')).toBeTruthy();
  });
});
