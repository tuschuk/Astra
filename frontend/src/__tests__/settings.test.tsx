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
 * And B47's Notifications section: four switches on by default; turning each off saves exactly
 * that one column (offline, one upload queued); stored values shown on open; a failed save
 * reverts; the push-state line for each state, with "Turn on push notifications" asking only when
 * tapped; sign-out forgets the push token first. The push port is a stand-in.
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
import type { PushState } from '@/notifications/pushRegistration';
import { setNotificationSwitch } from '@/settings/notificationSettings';
import { replaceFlairsTx } from '@/db/flairs';
import { DEFAULT_USER_SETTINGS, readUserSettingsRow } from '@/db/userSettings';
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
import SettingsScreen, { BODY_DATA_LINE, EXPORT_NOTE, NOTIFICATION_ROWS, PUSH_STATE_LINES } from '@/app/settings';
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

// B47: the push port is a stand-in, so each test sets where push stands; it has its own tests.
const mockPush = {
  register: jest.fn<(userId: string, options: { ask: boolean }) => Promise<PushState>>(),
  watchTokenChanges: jest.fn(() => () => {}),
  unregister: jest.fn(async () => {}),
};
// A getter, defined explicitly: the factory runs before `mockPush` is initialised (jest.mock is
// hoisted), and Babel's object-spread helper would read a literal getter right away.
jest.mock('@/notifications/pushRegistration', () =>
  Object.defineProperty(
    { ...jest.requireActual<typeof import('@/notifications/pushRegistration')>('@/notifications/pushRegistration') },
    'pushRegistration',
    { get: () => mockPush },
  ),
);

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
  mockPush.register.mockResolvedValue('unavailable');
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
  it('shows pounds selected by default and the signed-in email', async () => {
    await renderSignedIn(<SettingsScreen />);
    expect(screen.getByText('Units')).toBeTruthy();
    expect(screen.getByLabelText('Pounds').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Kilograms').props.accessibilityState.selected).toBe(false);
    expect(await screen.findByText('Signed in as')).toBeTruthy();
    expect(screen.getByText('lifter@example.com')).toBeTruthy();
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

  it('Sign out signs out of this device, forgetting its push token first (B47)', async () => {
    const view = await renderSignedIn(<SettingsScreen />);
    await screen.findByText('lifter@example.com');
    await fireEvent.press(screen.getByLabelText('Sign out'));
    await waitFor(() => expect(screen.queryByText('lifter@example.com')).toBeNull());
    expect(mockPush.unregister).toHaveBeenCalledTimes(1);
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

describe('Settings — Notifications (B47)', () => {
  /** The switch for one row, by its screen-reader label. */
  const switchFor = (label: string) => screen.getByLabelText(`Push notifications for ${label.toLowerCase()}`);

  /** Waits until the switches can be used (the settings have been read). */
  async function switchesReady(): Promise<void> {
    await waitFor(() => expect(switchFor(NOTIFICATION_ROWS[0].label).props.disabled).toBe(false));
  }

  it('shows all four switches on by default, and stays usable while push is unavailable on this build', async () => {
    await renderSignedIn(<SettingsScreen />);
    expect(screen.getByText('Notifications')).toBeTruthy();
    await switchesReady();
    for (const row of NOTIFICATION_ROWS) expect(switchFor(row.label).props.value).toBe(true);
    expect(await screen.findByText(PUSH_STATE_LINES.unavailable)).toBeTruthy();
    expect(screen.queryByLabelText('Turn on push notifications')).toBeNull();
    // The screen checks push without ever prompting.
    expect(mockPush.register).toHaveBeenCalledWith(SIGNED_IN_USER_ID, { ask: false });
  });

  for (const row of NOTIFICATION_ROWS) {
    it(`step DoD: turning off "${row.label}" saves exactly that switch, offline, with one upload queued`, async () => {
      await renderSignedIn(<SettingsScreen />);
      await switchesReady();
      await fireEvent(switchFor(row.label), 'valueChange', false);
      await waitFor(async () => expect((await readUserSettingsRow(db, SIGNED_IN_USER_ID))?.[row.field]).toBe(false));
      const stored = await readUserSettingsRow(db, SIGNED_IN_USER_ID);
      for (const other of NOTIFICATION_ROWS) {
        if (other.field !== row.field) expect(stored?.[other.field]).toBe(true);
      }
      expect(stored).toMatchObject({ unit: DEFAULT_USER_SETTINGS.unit, progress_pic_visibility: 'private' });
      expect((await pendingRows(db, 'user_settings')).map((p) => p.rowId)).toEqual([SIGNED_IN_USER_ID]);
      expect(switchFor(row.label).props.value).toBe(false);
    });
  }

  it('shows the phone’s stored switches when opened', async () => {
    await setNotificationSwitch(db, SIGNED_IN_USER_ID, 'notify_votes', false);
    await renderSignedIn(<SettingsScreen />);
    await switchesReady();
    expect(switchFor('Upvotes on your posts').props.value).toBe(false);
    expect(switchFor('New followers').props.value).toBe(true);
  });

  it('a failed save moves the switch back and says so', async () => {
    await renderSignedIn(<SettingsScreen />);
    await switchesReady();
    await db.execAsync('drop table outbox');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fireEvent(switchFor('Team posts'), 'valueChange', false);
    expect(await screen.findByText('Your notification setting couldn’t be saved. Try again.')).toBeTruthy();
    expect(switchFor('Team posts').props.value).toBe(true);
    warn.mockRestore();
  });

  it('when push is off, "Turn on push notifications" asks the phone and shows the result', async () => {
    mockPush.register.mockResolvedValueOnce('off').mockResolvedValueOnce('on');
    await renderSignedIn(<SettingsScreen />);
    expect(await screen.findByText(PUSH_STATE_LINES.off)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Turn on push notifications'));
    expect(await screen.findByText(PUSH_STATE_LINES.on)).toBeTruthy();
    expect(mockPush.register).toHaveBeenLastCalledWith(SIGNED_IN_USER_ID, { ask: true });
    expect(screen.queryByLabelText('Turn on push notifications')).toBeNull();
  });

  it('explains a refusal in phone settings, with no button to ask again', async () => {
    mockPush.register.mockResolvedValue('denied');
    await renderSignedIn(<SettingsScreen />);
    expect(await screen.findByText(PUSH_STATE_LINES.denied)).toBeTruthy();
    expect(screen.queryByLabelText('Turn on push notifications')).toBeNull();
  });

  it('offers Try again after a failed registration', async () => {
    mockPush.register.mockResolvedValue('failed');
    await renderSignedIn(<SettingsScreen />);
    expect(await screen.findByText(PUSH_STATE_LINES.failed)).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
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
