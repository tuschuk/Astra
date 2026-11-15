/**
 * Tests for another lifter's profile, `profile/[id]` (B25), with the in-memory fake social client
 * standing in for the server (it imitates no RLS — it is seeded with only what the viewer may
 * see; visibility itself is proven live at Gate 2):
 *   - the five header facts, counts equal to every follow row (more than the viewer could count);
 *   - Follow from the header flips the button and the Followers count re-reads to match (SOC-7);
 *     a block's refusal flips back with the calm sentence and the count stays;
 *   - their posts, their complete history paged from the server (not tappable), their PRs;
 *   - a profile that doesn't exist, and my own id opened here.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { FOLLOW_REFUSED } from '@/social/follows';
import { HISTORY_PAGE_SIZE } from '@/social/profile';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost } from '@/test-utils/feedFixtures';
import type { SqlDriver } from '@/db/driver';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';
import { PROFILE_MISSING } from '@/components/profile/ProfileView';

import ProfileScreen from '@/app/profile/[id]';

// The phone's database (only my own profile reads it; another lifter's never does).
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

let mockId = 'sam';
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockId }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = SIGNED_IN_USER_ID;
const sam = profile('sam', 'sam_lifts', 'Sam', { bio: 'Powerlifter.' });

/** A finished workout of Sam's as the server's history read returns it. */
function samWorkout(i: number) {
  const day = String(1 + (i % 28)).padStart(2, '0');
  const month = i < 28 ? '10' : '09';
  return {
    id: `w${String(i).padStart(3, '0')}`,
    user_id: 'sam',
    title: `Session ${i}`,
    started_at: `2026-${month}-${day}T09:00:00.000Z`,
    ended_at: `2026-${month}-${day}T10:00:00.000Z`,
    workout_exercises: [{ id: `e${i}`, position: 0, exercise: { name: 'Deadlift' }, sets: [{ id: `s${i}` }] }],
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockOpenDatabase.mockResolvedValue(await createPreparedDb());
  mockId = 'sam';
  mockSocial = createFakeSocialClient({
    profiles: [profile(ME, 'me_lifts', 'Me'), sam, profile('blocker', 'blocks_me', null)],
    follows: [
      { follower_id: 'x', followee_id: 'sam' },
      { follower_id: 'y', followee_id: 'sam' },
      { follower_id: 'sam', followee_id: 'x' },
    ],
    blocks: [{ blocker_id: 'blocker', blocked_id: ME }],
    posts: [
      rawPost({ id: 'sp', author: sam, createdAt: '2026-11-15T08:00:00.000Z', title: 'Sam pulls 300' }),
      rawPost({ id: 'mp', author: profile(ME, 'me_lifts', 'Me'), createdAt: '2026-11-15T09:00:00.000Z', title: 'My own post' }),
    ],
    workouts: Array.from({ length: HISTORY_PAGE_SIZE + 4 }, (_, i) => samWorkout(i)),
    personal_records: [
      { id: 'r1', user_id: 'sam', exercise_id: 'dl', kind: 'true1rm', reps: null, value_kg: 300, exercise: { name: 'Deadlift' } },
      { id: 'r2', user_id: 'sam', exercise_id: 'dl', kind: 'repMax', reps: 5, value_kg: 260, exercise: { name: 'Deadlift' } },
    ],
  });
});

function listed(): unknown[] {
  return screen.getByTestId('profile-list').props.data as unknown[];
}

describe('Another lifter’s profile (B25)', () => {
  it('renders the five facts; counts equal every follow row', async () => {
    await renderSignedIn(<ProfileScreen />);
    expect(await screen.findByText('@sam_lifts')).toBeTruthy();
    // The heading (the post card below also prints the name).
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0);
    expect(screen.getByText('Powerlifter.')).toBeTruthy();
    // No photo set: the header's (and the post card's) letter badge.
    expect(screen.getAllByTestId('letter-avatar', { includeHiddenElements: true }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Followers: 2')).toBeTruthy();
    expect(screen.getByLabelText('Following: 1')).toBeTruthy();
    expect(screen.queryByLabelText('Edit profile')).toBeNull();
  });

  it('follow from the header flips the button and the count re-reads to match; unfollow undoes both (SOC-7)', async () => {
    await renderSignedIn(<ProfileScreen />);
    await fireEvent.press(await screen.findByLabelText('Follow'));
    expect(await screen.findByLabelText('Followers: 3')).toBeTruthy();
    expect(screen.getByLabelText('Following')).toBeTruthy();
    expect(mockSocial.tables.follows).toContainEqual({ follower_id: ME, followee_id: 'sam' });
    await fireEvent.press(screen.getByLabelText('Following'));
    expect(await screen.findByLabelText('Followers: 2')).toBeTruthy();
    expect(screen.getByLabelText('Follow')).toBeTruthy();
  });

  it('a block-refused follow flips back with the calm sentence, and the count stays', async () => {
    mockId = 'blocker';
    await renderSignedIn(<ProfileScreen />);
    await fireEvent.press(await screen.findByLabelText('Follow'));
    expect(await screen.findByText(FOLLOW_REFUSED)).toBeTruthy();
    expect(screen.getByLabelText('Follow')).toBeTruthy();
    expect(screen.getByLabelText('Followers: 0')).toBeTruthy();
  });

  it('shows only their posts', async () => {
    await renderSignedIn(<ProfileScreen />);
    expect(await screen.findByText('Sam pulls 300')).toBeTruthy();
    expect(screen.queryByText('My own post')).toBeNull();
  });

  it('pages their complete history from the server; rows are not tappable (YOU-2)', async () => {
    await renderSignedIn(<ProfileScreen />);
    await fireEvent.press(await screen.findByLabelText('Show workout history'));
    expect(await screen.findByText(`Session ${HISTORY_PAGE_SIZE + 3}`)).toBeTruthy();
    expect(listed()).toHaveLength(HISTORY_PAGE_SIZE);
    await act(async () => {
      fireEvent(screen.getByTestId('profile-list'), 'onEndReached');
    });
    expect(listed()).toHaveLength(HISTORY_PAGE_SIZE + 4);
    expect(screen.queryAllByLabelText(/^Open workout from/)).toHaveLength(0);
  });

  it('lists their PRs per exercise in my unit (YOU-3)', async () => {
    await renderSignedIn(<ProfileScreen />);
    await fireEvent.press(await screen.findByLabelText('Show personal records'));
    expect(await screen.findByText('1RM 300 kg · 5RM 260 kg')).toBeTruthy();
  });

  it('a profile that does not exist says so', async () => {
    mockId = 'nobody';
    await renderSignedIn(<ProfileScreen />);
    expect(await screen.findByText(PROFILE_MISSING)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('my own id here shows my own profile: Edit, no Follow', async () => {
    mockId = ME;
    await renderSignedIn(<ProfileScreen />);
    expect(await screen.findByLabelText('Edit profile')).toBeTruthy();
    expect(screen.queryByLabelText('Follow')).toBeNull();
  });
});
