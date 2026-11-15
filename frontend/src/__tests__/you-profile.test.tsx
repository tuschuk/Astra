/**
 * Tests for the You tab — the lifter's own profile (B25). The step's definition of done, walked
 * through the real screen with real SQLite (the phone) and the in-memory fake social client (the
 * server):
 *   - all five header facts render: photo, name, bio, Followers and Following — and the counts
 *     are the number of follow rows;
 *   - the null state renders too (letter avatar, "Add a bio" hint);
 *   - PRs equal B13's stored records, printed by the one PR spelling;
 *   - the history is complete: more workouts than one page are walked to the first one, each
 *     opening its saved workout;
 *   - offline: the remembered name and bio still show, the counts show a dash, and the screen says
 *     counts and posts need a connection.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { resetOwnProfileCache, saveOwnProfile } from '@/social/ownProfileCache';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID, steadyOptions } from '@/test-utils/loggerTestKit';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { formatPrLine } from '@/workout/format';
import { currentPrs } from '@/workout/prs';
import { OWN_HISTORY_PAGE_SIZE, PROFILE_OFFLINE } from '@/components/profile/ProfileView';

import YouScreen from '@/app/(tabs)/you';

const mockOpenDatabase = jest.fn<() => Promise<SqlDriver>>();
jest.mock('@/db/database', () => ({
  ...jest.requireActual<typeof import('@/db/database')>('@/db/database'),
  openAppDatabase: () => mockOpenDatabase(),
}));

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

jest.mock('@/settings/displayUnit', () => ({ useDisplayUnit: () => 'kg' }));

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = SIGNED_IN_USER_ID;
const HIDDEN = { includeHiddenElements: true };
const SQUAT = libraryExerciseId('squat');
const BENCH = libraryExerciseId('bench_press');
const savedEnv = { ...process.env };
let db: SqlDriver;

beforeEach(async () => {
  jest.clearAllMocks();
  resetOwnProfileCache();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  db = await createPreparedDb();
  mockOpenDatabase.mockResolvedValue(db);
});

afterEach(() => {
  process.env = { ...savedEnv };
});

/** Logs and finishes a workout on the phone; returns its id. */
async function logWorkout(start: string, sets: [string, number, number][]): Promise<string> {
  const store = await startActiveWorkout(db, ME, steadyOptions(start));
  for (const [exerciseId, reps, kg] of sets) {
    const entry = await store.addExercise(exerciseId);
    await store.logSet(entry.id, { reps, weight: { value: kg, unit: 'kg' } });
  }
  await store.finish();
  return store.getSnapshot().workout.id;
}

/** The rows the list currently holds (virtualization-proof). */
function listed(): { kind: string }[] {
  return screen.getByTestId('profile-list').props.data as { kind: string }[];
}

describe('You — own profile (B25)', () => {
  it('renders all five header facts, with counts equal to the follow rows (step DoD)', async () => {
    mockSocial = createFakeSocialClient({
      profiles: [profile(ME, 'me_lifts', 'Sam Strong', { bio: 'Chasing a 200 kg squat.', avatar_url: `${ME}/face.jpg` })],
      follows: [
        { follower_id: 'a', followee_id: ME },
        { follower_id: 'b', followee_id: ME },
        { follower_id: ME, followee_id: 'c' },
      ],
    });
    await renderSignedIn(<YouScreen />);
    expect(await screen.findByText('Sam Strong')).toBeTruthy();
    expect(screen.getByText('@me_lifts')).toBeTruthy();
    expect(screen.getByText('Chasing a 200 kg squat.')).toBeTruthy();
    expect(screen.getByTestId('avatar-photo', HIDDEN).props.source.uri).toBe(
      `https://proj.supabase.co/storage/v1/object/public/avatars/${ME}/face.jpg`,
    );
    expect(screen.getByLabelText('Followers: 2')).toBeTruthy();
    expect(screen.getByLabelText('Following: 1')).toBeTruthy();
    // My own profile: Edit, never Follow; the gear still opens Settings.
    expect(screen.queryByLabelText('Follow')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Edit profile'));
    expect(mockPush).toHaveBeenLastCalledWith('/edit-profile');
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(mockPush).toHaveBeenLastCalledWith('/settings');
    // B15: the account (email, Sign out) has its one home in Settings, not here.
    expect(screen.queryByLabelText('Sign out')).toBeNull();
    expect(screen.queryByText(/@example\.com/)).toBeNull();
  });

  it('renders the null state: letter avatar, my name fallback, and the bio hint', async () => {
    mockSocial = createFakeSocialClient({ profiles: [profile(ME, null, null)] });
    await renderSignedIn(<YouScreen />);
    expect(await screen.findByText('Lifter')).toBeTruthy();
    expect(screen.getByText(/Add a bio/)).toBeTruthy();
    expect(screen.getByTestId('letter-avatar', HIDDEN)).toBeTruthy();
    expect(screen.getByLabelText('Followers: 0')).toBeTruthy();
  });

  it('shows my posts, read as the one-author feed', async () => {
    const me = profile(ME, 'me_lifts', 'Sam');
    mockSocial = createFakeSocialClient({
      profiles: [me, profile('o', 'other')],
      posts: [
        rawPost({ id: 'mine', author: me, createdAt: '2026-11-15T08:00:00.000Z', title: 'My heavy day' }),
        rawPost({ id: 'theirs', author: profile('o', 'other'), createdAt: '2026-11-15T09:00:00.000Z', title: 'Not mine' }),
      ],
    });
    await renderSignedIn(<YouScreen />);
    expect(await screen.findByText('My heavy day')).toBeTruthy();
    expect(screen.queryByText('Not mine')).toBeNull();
  });

  it('lists PRs per exercise exactly as B13 stored them (step DoD)', async () => {
    mockSocial = createFakeSocialClient({ profiles: [profile(ME, 'me_lifts')] });
    await logWorkout('2026-11-10T09:00:00.000Z', [
      [SQUAT, 1, 180],
      [BENCH, 5, 100],
    ]);
    await renderSignedIn(<YouScreen />);
    await fireEvent.press(await screen.findByLabelText('Show personal records'));
    for (const [exerciseId, name] of [
      [SQUAT, 'Squat'],
      [BENCH, 'Bench Press'],
    ] as const) {
      const expected = formatPrLine(await currentPrs(db, ME, exerciseId), 'kg');
      expect(expected).not.toBe('');
      expect(await screen.findByText(name)).toBeTruthy();
      expect(screen.getByText(expected)).toBeTruthy();
    }
  });

  it('pages my complete history from the phone, each row opening its saved workout (YOU-2)', async () => {
    mockSocial = createFakeSocialClient({ profiles: [profile(ME, 'me_lifts')] });
    const ids: string[] = [];
    const total = OWN_HISTORY_PAGE_SIZE + 5;
    for (let i = 0; i < total; i += 1) {
      const day = String(1 + Math.floor(i / 2)).padStart(2, '0');
      ids.push(await logWorkout(`2026-10-${day}T${i % 2 === 0 ? '08' : '17'}:00:00.000Z`, [[SQUAT, 5, 100]]));
    }
    await renderSignedIn(<YouScreen />);
    await fireEvent.press(await screen.findByLabelText('Show workout history'));
    await screen.findAllByLabelText(/^Open workout from/);
    expect(listed()).toHaveLength(OWN_HISTORY_PAGE_SIZE);
    await act(async () => {
      fireEvent(screen.getByTestId('profile-list'), 'onEndReached');
    });
    expect(listed()).toHaveLength(total);
    const shownIds = (listed() as unknown as { row: { summary: { workout: { id: string } } } }[]).map((i) => i.row.summary.workout.id);
    expect(new Set(shownIds)).toEqual(new Set(ids));

    const first = screen.getAllByLabelText(/^Open workout from/)[0];
    await fireEvent.press(first);
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/workout/[id]', params: { id: shownIds[0] } });
  });

  it('offline: my remembered name and bio still show; counts are a dash with the connection line', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    saveOwnProfile(ME, { username: 'me_lifts', displayName: 'Sam Remembered', bio: 'Offline bio.', avatarPath: null });
    mockSocial = createFakeSocialClient({}, { offline: true });
    await renderSignedIn(<YouScreen />);
    expect(await screen.findByText(PROFILE_OFFLINE)).toBeTruthy();
    expect(screen.getByText('Sam Remembered')).toBeTruthy();
    expect(screen.getByText('Offline bio.')).toBeTruthy();
    expect(screen.getByLabelText('Followers: unknown')).toBeTruthy();
    expect(within(screen.getByLabelText('Following: unknown')).getByText('—')).toBeTruthy();
    warn.mockRestore();
  });
});
