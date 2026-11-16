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
 * And B43's (TK-6): opened mid-workout, each of the four calculators arrives filled in from the
 * exercise in progress (its last set) and the lifter's stored records (the e1RM book, made here
 * by finishing an earlier session); a typed-over value survives a reopen until the next set is
 * logged; the plate target follows the rack's unit; a tab-tile open is never prefilled; and a
 * failed read still opens the panel.
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
import { displayWeight, epleyE1rm, lbToKg } from '@training-math';
import KeyValueStore from 'expo-sqlite/kv-store';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb, lb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import {
  DEFAULT_PLATE_RACKS,
  PLATE_RACK_KEY,
  resetPlateRackCache,
  serializePlateRacks,
} from '@/toolkit/plateRack';
import { resetToolKitPrefill } from '@/toolkit/prefill';
import { resetToolKitSession } from '@/toolkit/session';
import * as prsModule from '@/workout/prs';
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
  resetToolKitPrefill();
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

describe('Tool Kit prefill (B43 / TK-6 definition of done)', () => {
  const BENCH = libraryExerciseId('bench_press');

  /** A finished earlier bench session (245 lb × 3), so the lifter has stored bench records. */
  async function finishEarlierBench(): Promise<void> {
    const earlier = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions('2026-11-10T09:00:00.000Z'));
    const entry = await earlier.addExercise(BENCH);
    await earlier.logSet(entry.id, lb(3, 245));
    await earlier.finish();
    clearSessionWorkout();
  }

  /** The stored best-e1RM record for bench, as the 1RM boxes should show it (lb). */
  async function storedE1rmText(): Promise<string> {
    const record = (await prsModule.currentPrs(db, SIGNED_IN_USER_ID, BENCH)).find((r) => r.kind === 'e1rm');
    if (!record) throw new Error('expected a stored e1RM record');
    return String(displayWeight(record.value_kg, 'lb'));
  }

  it('a mid-workout open arrives prefilled in each calculator; typing over a value sticks until the next set', async () => {
    await finishEarlierBench();
    const e1rm = await storedE1rmText();
    // Today: bench 225 lb × 5 @ RPE 8.
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID);
    const entry = await store.addExercise(BENCH);
    await store.logSet(entry.id, lb(5, 225, { rpe: 8 }));

    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByLabelText('Remove set 1 of Bench Press');
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    await screen.findByRole('header', { name: 'Tool Kit' });

    // 1RM calculator: the last set.
    expect(screen.getByLabelText('Weight (lb)').props.value).toBe('225');
    expect(screen.getByLabelText('Reps').props.value).toBe('5');
    // RPE calculator: the stored e1RM (not the set's weight), chips on the set's 5 @ 8.
    await fireEvent.press(screen.getByLabelText('RPE calculator'));
    expect(screen.getByLabelText('1RM (lb)').props.value).toBe(e1rm);
    expect(screen.getByLabelText('5 reps').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('RPE 8').props.accessibilityState).toMatchObject({ selected: true });
    // %1RM calculator: the same 1RM, percent left for the lifter.
    await fireEvent.press(screen.getByLabelText('Intensity calculator'));
    expect(screen.getByLabelText('1RM (lb)').props.value).toBe(e1rm);
    expect(screen.getByLabelText('Percent of 1RM (%)').props.value).toBe('');
    // Plate loader: the set's weight as the target.
    await fireEvent.press(screen.getByLabelText('Plate loader'));
    expect((await screen.findByLabelText('Target (lb)')).props.value).toBe('225');

    // Typed over, closed, reopened with nothing new logged: the lifter's number stands.
    await fireEvent.changeText(screen.getByLabelText('Target (lb)'), '235');
    await fireEvent.press(screen.getByLabelText('Close'));
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    expect((await screen.findByLabelText('Target (lb)')).props.value).toBe('235');
    await fireEvent.press(screen.getByLabelText('Close'));

    // The next set is logged on the logger: the reopened Tool Kit follows it.
    await fireEvent.changeText(screen.getByLabelText('Reps for Bench Press'), '3');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Bench Press'), '245');
    await fireEvent.changeText(screen.getByLabelText('RPE for Bench Press'), '9.5');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await screen.findByLabelText('Remove set 2 of Bench Press');
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    expect((await screen.findByLabelText('Target (lb)')).props.value).toBe('245');
    await fireEvent.press(screen.getByLabelText('RPE calculator'));
    expect(screen.getByLabelText('3 reps').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('RPE 9.5').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('fills the plate target in the rack’s unit when it differs from the display unit', async () => {
    resetPlateRackCache();
    await KeyValueStore.setItem(PLATE_RACK_KEY, serializePlateRacks({ ...DEFAULT_PLATE_RACKS, unit: 'kg' }));
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID);
    const entry = await store.addExercise(BENCH);
    await store.logSet(entry.id, lb(5, 225));

    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByLabelText('Remove set 1 of Bench Press');
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    await fireEvent.press(await screen.findByLabelText('Plate loader'));
    // 225 lb as saved (kg), shown in the kg rack's unit.
    const savedKg = store.getSnapshot().entries[0]?.sets[0]?.weight_kg ?? 0;
    expect((await screen.findByLabelText('Target (kg)')).props.value).toBe(String(displayWeight(savedKg, 'kg')));
  });

  it('with no set logged, the exercise just added fills the 1RM boxes from its stored record', async () => {
    await finishEarlierBench();
    const e1rm = await storedE1rmText();
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID);
    await store.addExercise(BENCH);

    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByLabelText('Reps for Bench Press');
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    await fireEvent.press(await screen.findByLabelText('Intensity calculator'));
    expect(screen.getByLabelText('1RM (lb)').props.value).toBe(e1rm);
    await fireEvent.press(screen.getByLabelText('1RM calculator'));
    expect(screen.getByLabelText('Weight (lb)').props.value).toBe('');
  });

  it('a Workout tab tile open applies no prefill', async () => {
    await finishEarlierBench();
    await renderSignedIn(<WorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Open RPE calculator'));
    expect(screen.getByLabelText('1RM (lb)').props.value).toBe('');
  });

  it('still opens, unprefilled, when the records can’t be read', async () => {
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID);
    const entry = await store.addExercise(BENCH);
    await store.logSet(entry.id, lb(5, 225));
    await renderSignedIn(<ActiveWorkoutScreen />);
    await screen.findByLabelText('Remove set 1 of Bench Press');

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(prsModule, 'currentPrs').mockRejectedValueOnce(new Error('disk on fire'));
    await fireEvent.press(screen.getByLabelText('Open Tool Kit'));
    expect(await screen.findByRole('header', { name: 'Tool Kit' })).toBeTruthy();
    expect(screen.getByLabelText('Weight (lb)').props.value).toBe('');
    expect(warn).toHaveBeenCalledWith('Logger: could not prefill the Tool Kit', expect.any(Error));
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
