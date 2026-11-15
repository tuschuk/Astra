/**
 * The B16 definition of done through the real screens:
 *
 *   - from a workout in progress, ONE press on the floating Tool Kit button opens the Tool Kit;
 *   - a calculation is made, the panel is closed, and the logger is exactly as it was — its
 *     logged sets and a half-typed reps box untouched;
 *   - reopening finds the calculator's numbers restored (the panel's contents are rebuilt on
 *     every open, so this is `toolkit/session.ts` at work, not luck);
 *   - a Workout tab tile opens the Tool Kit straight at its calculator (or the timer).
 *
 * And the B17 timer's: a countdown started in the panel keeps running after the panel is closed
 * (the panel's contents are thrown away), so reopening it a minute later shows a minute less.
 *
 * No transport, no network stand-in, no Supabase client anywhere in this file: the Tool Kit
 * has nothing to reach, which is the offline proof. Real SQLite comes in through a mocked
 * `openAppDatabase`; the router is a stub. (Lives outside src/app because expo-router would
 * register *.test.tsx there as routes.)
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { epleyE1rm, lbToKg } from '@training-math';
import KeyValueStore from 'expo-sqlite/kv-store';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';
import { PLATE_RACK_KEY, resetPlateRackCache } from '@/toolkit/plateRack';
import { resetToolKitSession } from '@/toolkit/session';
import type { TimerAlertsPort } from '@/toolkit/timerAlerts';
import { resetTimerStore } from '@/toolkit/timerStore';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { clearSessionWorkout } from '@/workout/activeWorkoutSession';
import { formatWeight } from '@/workout/format';

import WorkoutScreen from '@/app/(tabs)/workout';
import ActiveWorkoutScreen from '@/app/active-workout';

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

let db: SqlDriver;
let alerts: { schedule: jest.Mock<TimerAlertsPort['schedule']>; cancel: jest.Mock<TimerAlertsPort['cancel']> };

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
  // The timer's notifications go to a fake: no real phone feature under Jest.
  alerts = {
    schedule: jest.fn<TimerAlertsPort['schedule']>(async () => 'scheduled'),
    cancel: jest.fn<TimerAlertsPort['cancel']>(async () => undefined),
  };
  resetTimerStore(alerts);
});

afterEach(async () => {
  resetTimerStore();
  clearSessionWorkout();
  resetToolKitSession();
  resetPlateRackCache();
  await KeyValueStore.removeItem(PLATE_RACK_KEY);
  jest.restoreAllMocks();
});

describe('Tool Kit (B16 definition of done)', () => {
  it('opens from the logger in one tap and closes back to the logger exactly as it was', async () => {
    // A workout in progress with one bench set logged.
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID);
    const entry = await store.addExercise(libraryExerciseId('bench_press'));
    await store.logSet(entry.id, { reps: 5, weight: { value: 225, unit: 'lb' } });

    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByLabelText('Remove set 1 of Bench Press');
    // Half-way through typing the next set.
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '4');
    // (The panel's header is the only "Tool Kit" heading; the floating button is a button.)
    expect(screen.queryByRole('header', { name: 'Tool Kit' })).toBeNull();

    // One press.
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    expect(screen.getByRole('header', { name: 'Tool Kit' })).toBeTruthy();

    // A 1RM calculation in the lifter's unit (lb by default).
    await fireEvent.changeText(screen.getByLabelText('Weight (lb)'), '225');
    await fireEvent.changeText(screen.getByLabelText('Reps'), '5');
    const answer = formatWeight(epleyE1rm(lbToKg(225), 5), 'lb');
    expect(screen.getByLabelText(`Estimated 1RM: ${answer}`)).toBeTruthy();

    // Close: the logger is untouched.
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByRole('header', { name: 'Tool Kit' })).toBeNull();
    expect(screen.getByLabelText('Remove set 1 of Bench Press')).toBeTruthy();
    expect(screen.getByLabelText('Reps for Bench Press').props.value).toBe('4');

    // Reopen: the calculator's numbers are back.
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    expect(screen.getByLabelText('Weight (lb)').props.value).toBe('225');
    expect(screen.getByLabelText(`Estimated 1RM: ${answer}`)).toBeTruthy();
  });

  it('a Workout tab tile opens the Tool Kit at its tool, the Timer included', async () => {
    await renderSignedIn(<WorkoutScreen />);
    await screen.findByText('Finished workouts show up here.');
    // The Timer tile (B17) opens the panel straight at the timer.
    await fireEvent.press(screen.getByLabelText('Open Timer'));
    expect(screen.getByLabelText('Timer').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('Time left: 2:00')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Close'));

    await fireEvent.press(screen.getByLabelText('Open Plate loader'));
    expect(screen.getByLabelText('Plate loader').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.changeText(await screen.findByLabelText('Target (lb)'), '225');
    expect(screen.getByText('2 × 45 lb')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Close'));
    await fireEvent.press(screen.getByLabelText('Open RPE calculator'));
    expect(screen.getByText('Target reps')).toBeTruthy();
  });
});

describe('Tool Kit timer (B17 definition of done)', () => {
  it('keeps running while the panel is closed: reopened later, it shows the right time', async () => {
    const T = 1_700_000_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(T);
    await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await renderSignedIn(<ActiveWorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Open Tool Kit'));
    await fireEvent.press(screen.getByLabelText('Timer'));
    await fireEvent.press(screen.getByLabelText('1:30 rest'));
    await fireEvent.press(screen.getByLabelText('Start'));
    expect(alerts.schedule).toHaveBeenCalledWith(T + 90_000, expect.any(String), expect.any(String));

    // Close the panel to log a set: everything in it is thrown away…
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByLabelText(/^Time left/)).toBeNull();
    // …a minute passes (or the phone sat locked for a minute)…
    clock.mockReturnValue(T + 60_000);
    // …and the reopened panel is back on the timer with 30 seconds left.
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    expect(screen.getByLabelText('Time left: 0:30')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Reset'));
    expect(alerts.cancel).toHaveBeenCalled();
  });
});
