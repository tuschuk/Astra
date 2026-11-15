/**
 * The B15 definition of done, through the real screens, the real unit store and real SQLite:
 *
 *   - Settings shows the kg | lb choice (pounds by default) and the signed-in email;
 *   - flipping it re-draws every mounted weight — a saved workout open beside it switches from
 *     "220.5 lb" to "100 kg" and back — while the stored kg value stays byte-identical;
 *   - flipping it in the middle of logging: each set stores exactly what its own unit implies;
 *   - Sign out signs out of this device.
 *
 * And B26's Privacy section: progress pics private by default; choosing Followers is saved on the
 * phone and queued (keeping the unit) and takes effect for the very next progress pic; the stored
 * choice is shown on open; a failed save reverts; body data is stated as owner-only.
 *
 * And B32's Account additions: Export your data runs the export flow (mocked) and shows its
 * line; Delete account opens the delete screen.
 *
 * Settings is rendered next to the screen that shows the weights, so the test sees one tree
 * re-render, the way a mounted screen under Settings would. The router is a stub; the database
 * comes through a mocked `openAppDatabase`.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { lbToKg } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import { replaceFlairsTx } from '@/db/flairs';
import { readUserSettingsRow } from '@/db/userSettings';
import { libraryExerciseId } from '@/library/uuidv5';
import { setProgressPicVisibility } from '@/settings/privacySettings';
import { unitStore } from '@/settings/unitStore';
import { createImagePost } from '@/social/createPost';
import { pendingRows } from '@/sync/outbox';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { clearSessionWorkout } from '@/workout/activeWorkoutSession';
import { startActiveWorkout } from '@/workout/activeWorkout';

import WorkoutScreen from '@/app/(tabs)/workout';
import ActiveWorkoutScreen from '@/app/active-workout';
import { EXPORT_OFFLINE } from '@/account/exportData';
import SettingsScreen, { BODY_DATA_LINE, EXPORT_NOTE } from '@/app/settings';
import SavedWorkoutScreen from '@/app/workout/[id]';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

// B32: the export flow and the Supabase client are stand-ins; the flow has its own tests.
const mockClient = { functions: { invoke: jest.fn() } };
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockClient,
}));
const mockExport = jest.fn<(client: unknown) => Promise<{ ok: true } | { ok: false; message: string }>>();
jest.mock('@/account/exportData', () => ({
  ...jest.requireActual<typeof import('@/account/exportData')>('@/account/exportData'),
  exportMyData: (client: unknown) => mockExport(client),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) };
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
  unitStore.reset();
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

afterEach(() => {
  clearSessionWorkout();
  unitStore.reset();
});

/** The stored weights of every set on the phone, oldest first. */
function storedWeights(): Promise<{ id: string; weight_kg: number | null }[]> {
  return db.getAllAsync<{ id: string; weight_kg: number | null }>('select id, weight_kg from sets order by created_at, id');
}

/** Waits until the toggle can be used (the database has opened). */
async function toggleReady(): Promise<void> {
  await waitFor(() => expect(screen.getByLabelText('Kilograms').props.accessibilityState.disabled).toBe(false));
}

describe('Settings screen (B15)', () => {
  it('shows pounds selected by default, the signed-in email, and no Notifications yet', async () => {
    await renderSignedIn(<SettingsScreen />);
    expect(screen.getByText('Units')).toBeTruthy();
    expect(screen.getByLabelText('Pounds').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Kilograms').props.accessibilityState.selected).toBe(false);
    expect(await screen.findByText('Signed in as')).toBeTruthy();
    expect(screen.getByText('lifter@example.com')).toBeTruthy();
    expect(screen.queryByText(/Notifications/)).toBeNull();
  });

  it('step DoD: switching units converts every displayed weight without changing a stored kg value', async () => {
    const store = await startActiveWorkout(db, SIGNED_IN_USER_ID, steadyOptions('2026-11-12T12:00:00.000Z'));
    const squat = await store.addExercise(libraryExerciseId('squat'));
    await store.logSet(squat.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    await store.finish();
    mockParams = { id: store.getSnapshot().workout.id };
    const before = await storedWeights();
    expect(before.map((s) => s.weight_kg)).toEqual([100]);

    await renderSignedIn(
      <>
        <SettingsScreen />
        <SavedWorkoutScreen />
      </>,
    );
    expect(await screen.findByText('5 × 220.5 lb')).toBeTruthy();
    await toggleReady();

    await fireEvent.press(screen.getByLabelText('Kilograms'));
    expect(await screen.findByText('5 × 100 kg')).toBeTruthy();
    expect(screen.queryByText('5 × 220.5 lb')).toBeNull();
    expect(screen.getByLabelText('Kilograms').props.accessibilityState.selected).toBe(true);
    expect(await storedWeights()).toEqual(before);
    // Saved on the phone and queued for the server.
    expect((await readUserSettingsRow(db, SIGNED_IN_USER_ID))?.unit).toBe('kg');
    expect((await pendingRows(db, 'user_settings')).map((p) => p.rowId)).toEqual([SIGNED_IN_USER_ID]);

    await fireEvent.press(screen.getByLabelText('Pounds'));
    expect(await screen.findByText('5 × 220.5 lb')).toBeTruthy();
    expect(await storedWeights()).toEqual(before); // no drift after a round trip
  });

  it('a flip mid-workout: each set stores exactly what its own unit implies, and no stored value changes', async () => {
    const tab = await renderSignedIn(<WorkoutScreen />);
    await screen.findByText('Finished workouts show up here.');
    await fireEvent.press(screen.getByLabelText('Start empty workout'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/active-workout'));
    await tab.unmount();

    await renderSignedIn(
      <>
        <SettingsScreen />
        <ActiveWorkoutScreen />
      </>,
    );
    await screen.findByText('No exercises yet. Add the first one to start logging.');
    await fireEvent.press(screen.getByLabelText('Add exercise'));
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'squats');
    await fireEvent.press(screen.getByLabelText('Add Squat'));

    // In pounds: 220.5 typed means exactly 220.5 lb.
    await fireEvent.changeText(await screen.findByLabelText('Reps for Squat'), '5');
    await fireEvent.changeText(screen.getByLabelText('Weight in lb for Squat'), '220.5');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await screen.findByLabelText('Remove set 1 of Squat');
    const [first] = await storedWeights();
    expect(first.weight_kg).toBeCloseTo(lbToKg(220.5), 2);
    expect(first.weight_kg).not.toBe(100); // display rounding never feeds storage

    // Flip to kg: the logged set re-draws, the entry field now reads kilograms.
    await toggleReady();
    await fireEvent.press(screen.getByLabelText('Kilograms'));
    await fireEvent.changeText(await screen.findByLabelText('Weight in kg for Squat'), '100');
    await fireEvent.changeText(screen.getByLabelText('Reps for Squat'), '5');
    await fireEvent.press(screen.getByLabelText('Log set'));
    await screen.findByLabelText('Remove set 2 of Squat');

    const weights = await storedWeights();
    expect(weights).toHaveLength(2);
    expect(weights[0]).toEqual(first); // the flip changed nothing already stored
    expect(weights[1].weight_kg).toBe(100);
  });

  it('Sign out signs out of this device', async () => {
    const view = await renderSignedIn(<SettingsScreen />);
    await screen.findByText('lifter@example.com');
    await fireEvent.press(screen.getByLabelText('Sign out'));
    await waitFor(() => expect(screen.queryByText('lifter@example.com')).toBeNull());
    await view.unmount();
  });

  it('Back goes to the You tab when there is nothing to go back to', async () => {
    await renderSignedIn(<SettingsScreen />);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/you');
  });
});

describe('Settings — Privacy (B26)', () => {
  const ONLY_ME = 'New progress pics: only you';
  const FOLLOWERS = 'New progress pics: your followers';

  /** Waits until the privacy chips can be used (the setting has been read). */
  async function privacyReady(): Promise<void> {
    await waitFor(() => expect(screen.getByLabelText(ONLY_ME).props.accessibilityState.disabled).toBe(false));
  }

  it('shows the section with progress pics private by default, and the body-data statement', async () => {
    await renderSignedIn(<SettingsScreen />);
    expect(screen.getByText('Privacy')).toBeTruthy();
    await privacyReady();
    expect(screen.getByLabelText(ONLY_ME).props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(BODY_DATA_LINE)).toBeTruthy();
    expect(screen.getByText(/change one from the post itself/)).toBeTruthy();
  });

  it('choosing Followers saves it on the phone and queues one upload, keeping the unit; a new progress pic is then born followers-only', async () => {
    await renderSignedIn(<SettingsScreen />);
    await toggleReady();
    await fireEvent.press(screen.getByLabelText('Kilograms'));
    await privacyReady();
    await fireEvent.press(screen.getByLabelText(FOLLOWERS));
    await waitFor(async () => expect((await readUserSettingsRow(db, SIGNED_IN_USER_ID))?.progress_pic_visibility).toBe('followers'));
    expect(screen.getByLabelText(FOLLOWERS).props.accessibilityState.selected).toBe(true);
    expect((await readUserSettingsRow(db, SIGNED_IN_USER_ID))?.unit).toBe('kg');
    expect((await pendingRows(db, 'user_settings')).map((p) => p.rowId)).toEqual([SIGNED_IN_USER_ID]);

    // Takes effect immediately: the very next progress pic uses it, no sync needed.
    await db.withTransactionAsync((tx) => replaceFlairsTx(tx, new FakeServer().flairs));
    const post = await createImagePost(
      db,
      SIGNED_IN_USER_ID,
      'progress-pic',
      { uri: 'file:///x.jpg', byteSize: 1000, mimeType: 'image/jpeg' },
      { saveImage: async () => 'file:///saved.jpg' },
    );
    expect(post.visibility).toBe('followers');
  });

  it('shows the phone’s stored choice when opened', async () => {
    await setProgressPicVisibility(db, SIGNED_IN_USER_ID, 'public');
    await renderSignedIn(<SettingsScreen />);
    await privacyReady();
    expect(screen.getByLabelText('New progress pics: anyone on Astra').props.accessibilityState.selected).toBe(true);
  });

  it('a failed save moves the chip back and says so', async () => {
    await renderSignedIn(<SettingsScreen />);
    await privacyReady();
    await db.execAsync('drop table outbox'); // make the save's transaction fail
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fireEvent.press(screen.getByLabelText(FOLLOWERS));
    expect(await screen.findByText('Your privacy setting couldn’t be saved. Try again.')).toBeTruthy();
    expect(screen.getByLabelText(ONLY_ME).props.accessibilityState.selected).toBe(true);
    warn.mockRestore();
  });
});

describe('Settings — Export and Delete account (B32)', () => {
  it('Export your data runs the export with the signed-in client and shows its failure line', async () => {
    mockExport.mockResolvedValue({ ok: false, message: EXPORT_OFFLINE });
    await renderSignedIn(<SettingsScreen />);
    expect(screen.getByText(EXPORT_NOTE)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Export your data'));
    expect(await screen.findByText(EXPORT_OFFLINE)).toBeTruthy();
    expect(mockExport).toHaveBeenCalledWith(mockClient);
    expect(screen.getByLabelText('Export your data').props.accessibilityState.disabled).toBe(false);
  });

  it('a successful export shows no message', async () => {
    mockExport.mockResolvedValue({ ok: true });
    await renderSignedIn(<SettingsScreen />);
    await fireEvent.press(screen.getByLabelText('Export your data'));
    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(EXPORT_OFFLINE)).toBeNull();
  });

  it('Delete account opens the delete screen', async () => {
    await renderSignedIn(<SettingsScreen />);
    await fireEvent.press(screen.getByLabelText('Delete account'));
    expect(mockRouter.push).toHaveBeenCalledWith('/delete-account');
  });
});
