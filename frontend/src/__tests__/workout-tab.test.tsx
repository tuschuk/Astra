/**
 * Tests for the Workout tab (LOG-1's button): Start when nothing is in progress, Resume /
 * Discard when something is, the list of past workouts, and (B35, PRG-3) running a program —
 * the picker, the run card's Start next session (prefilled), Start empty workout during a run,
 * Stop program, and the no-next-session state. Runs on a real SQLite database
 * handed to the screen through a mocked `openAppDatabase`; the router is a stub.
 * (Lives outside src/app because expo-router would register *.test.tsx there as routes.)
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { readActiveRun, startProgramRun } from '@/programs/programRuns';
import { addProgramExercise, addProgramWorkout, addWeek, createProgram } from '@/programs/programs';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { loadActiveWorkout, startActiveWorkout } from '@/workout/activeWorkout';
import { clearSessionWorkout, currentSessionWorkout } from '@/workout/activeWorkoutSession';
import { workoutDateLabel } from '@/workout/format';

import WorkoutScreen from '@/app/(tabs)/workout';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const BENCH = libraryExerciseId('bench_press');
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

/** Logs and finishes a one-exercise workout at `start`; returns its id. */
async function finishedWorkout(start: string, reps: number[]): Promise<string> {
  const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions(start));
  const entry = await store.addExercise(BENCH);
  for (const r of reps) await store.logSet(entry.id, { reps: r });
  await store.finish();
  return store.getSnapshot().workout.id;
}

describe('Workout tab', () => {
  it('offers Start when nothing is in progress, plus the Tool Kit and an empty history', async () => {
    await renderSignedIn(<WorkoutScreen />);
    expect(await screen.findByText('Finished workouts show up here.')).toBeTruthy();
    expect(screen.getByText('Start empty workout')).toBeTruthy();
    expect(screen.getByText('Start from a program')).toBeTruthy();
    expect(screen.queryByText('Resume workout')).toBeNull();
    for (const tool of ['1RM', 'RPE', '%1RM', 'Plates', 'Timer']) expect(screen.getByText(tool)).toBeTruthy();
  });

  it('Your programs opens the program builder (B34)', async () => {
    await renderSignedIn(<WorkoutScreen />);
    await screen.findByText('Finished workouts show up here.');
    await fireEvent.press(screen.getByLabelText('Your programs'));
    expect(mockRouter.push).toHaveBeenCalledWith('/programs');
  });

  it('Start empty workout starts a blank workout and opens the logger', async () => {
    await renderSignedIn(<WorkoutScreen />);
    await screen.findByText('Finished workouts show up here.');
    await fireEvent.press(screen.getByLabelText('Start empty workout'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/active-workout'));
    const store = currentSessionWorkout(SIGNED_IN_USER_ID);
    expect(store?.getSnapshot().entries).toEqual([]);
    expect((await loadActiveWorkout(db, SIGNED_IN_USER_ID))?.getSnapshot().workout.id).toBe(
      store?.getSnapshot().workout.id,
    );
  });

  it('offers Resume (not Start) when a workout is in progress — e.g. after the app was killed', async () => {
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<WorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Resume workout'));
    expect(mockRouter.push).toHaveBeenCalledWith('/active-workout');
    expect(screen.queryByText('Start empty workout')).toBeNull();
  });

  it('Discard asks first, then deletes the workout in progress', async () => {
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderSignedIn(<WorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Discard workout'));
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).not.toBeNull(); // nothing yet
    buttons.find((b) => b.text === 'Discard workout')?.onPress?.();
    expect(await screen.findByText('Start empty workout')).toBeTruthy();
    expect(await loadActiveWorkout(db, SIGNED_IN_USER_ID)).toBeNull();
  });

  it('lists finished workouts newest first, each opening the saved workout', async () => {
    const older = await finishedWorkout('2026-11-10T12:00:00.000Z', [5]);
    const newer = await finishedWorkout('2026-11-12T12:00:00.000Z', [5, 5, 5]);
    await renderSignedIn(<WorkoutScreen />);
    const newerLabel = workoutDateLabel('2026-11-12T12:00:00.000Z');
    const olderLabel = workoutDateLabel('2026-11-10T12:00:00.000Z');
    await screen.findByText(newerLabel);
    const rows = screen.getAllByLabelText(/^Open workout from/);
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      `Open workout from ${newerLabel}`,
      `Open workout from ${olderLabel}`,
    ]);
    // The store's test clock moves one minute per reading: start, add, three sets, finish.
    expect(screen.getByText('5 min · 1 exercise · 3 sets')).toBeTruthy();
    await fireEvent.press(rows[1]);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/workout/[id]', params: { id: older } });
    expect(newer).not.toBe(older);
  });
});

/** A one-week program "Block" with Day A (bench 3 × 5 @ 135 lb) and Day B; returns its id. */
async function blockProgram(): Promise<string> {
  const p = await createProgram(db, SIGNED_IN_USER_ID, 'Block');
  const week = await addWeek(db, SIGNED_IN_USER_ID, p.id);
  const dayA = await addProgramWorkout(db, SIGNED_IN_USER_ID, week.id, 'Day A');
  await addProgramExercise(db, SIGNED_IN_USER_ID, dayA.id, {
    exerciseId: BENCH,
    targets: { sets: 3, reps: 5, weight: { value: 135, unit: 'lb' }, rpe: null },
  });
  await addProgramWorkout(db, SIGNED_IN_USER_ID, week.id, 'Day B');
  return p.id;
}

describe('Workout tab — running a program (B35)', () => {
  it('Start from a program opens the picker; picking one shows the run card', async () => {
    await blockProgram();
    await renderSignedIn(<WorkoutScreen />);
    await screen.findByText('Finished workouts show up here.');
    await fireEvent.press(screen.getByLabelText('Start from a program'));
    await fireEvent.press(await screen.findByLabelText('Start Block'));
    expect(await screen.findByText('Next: Week 1 · Day A')).toBeTruthy();
    expect(screen.getByText('Start next session')).toBeTruthy();
    expect(screen.queryByText('Start from a program')).toBeNull();
  });

  it('Start next session opens the logger on the prefilled session; the tab then offers the next one', async () => {
    const programId = await blockProgram();
    await startProgramRun(db, SIGNED_IN_USER_ID, programId);
    await renderSignedIn(<WorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Start next session'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/active-workout'));
    const store = currentSessionWorkout(SIGNED_IN_USER_ID);
    expect(store?.getSnapshot().workout.title).toBe('Block — Week 1 · Day A');
    expect(store?.getSnapshot().entries.map((e) => e.notes)).toEqual(['Target: 3 × 5 @ 135 lb']);

    await store?.finish();
    clearSessionWorkout();
    expect((await readActiveRun(db, SIGNED_IN_USER_ID))?.nextSession?.workout.label).toBe('Day B');
  });

  it('keeps Start empty workout during a run, and it starts an unlinked workout', async () => {
    const programId = await blockProgram();
    await startProgramRun(db, SIGNED_IN_USER_ID, programId);
    await renderSignedIn(<WorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Start empty workout'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/active-workout'));
    expect(currentSessionWorkout(SIGNED_IN_USER_ID)?.getSnapshot().workout.program_workout_id).toBeNull();
  });

  it('Stop program asks first, then ends the run', async () => {
    const programId = await blockProgram();
    await startProgramRun(db, SIGNED_IN_USER_ID, programId);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderSignedIn(<WorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Stop program'));
    expect(await readActiveRun(db, SIGNED_IN_USER_ID)).not.toBeNull(); // nothing yet
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    buttons.find((b) => b.text === 'Stop program')?.onPress?.();
    expect(await screen.findByText('Start from a program')).toBeTruthy();
    expect(await readActiveRun(db, SIGNED_IN_USER_ID)).toBeNull();
  });

  it('says so when the running program has no next session', async () => {
    const programId = await blockProgram();
    await startProgramRun(db, SIGNED_IN_USER_ID, programId);
    await db.runAsync('update program_workouts set deleted_at = ?', ['2026-11-15T12:00:00.000Z']);
    await renderSignedIn(<WorkoutScreen />);
    expect(await screen.findByText('This program has no next session.')).toBeTruthy();
    expect(screen.queryByText('Start next session')).toBeNull();
    expect(screen.getByText('Stop program')).toBeTruthy();
  });

  it('hides the run card while a workout is in progress', async () => {
    const programId = await blockProgram();
    await startProgramRun(db, SIGNED_IN_USER_ID, programId);
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<WorkoutScreen />);
    expect(await screen.findByLabelText('Resume workout')).toBeTruthy();
    expect(screen.queryByText('Start next session')).toBeNull();
  });
});
