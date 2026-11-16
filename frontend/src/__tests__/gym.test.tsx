/**
 * Tests for the gym page (B50). The step's definition of done, app side: joining a second gym
 * switches the active one (asked first, naming the gym being left), and the Gym feed works like
 * a Team feed — members' posts newest first through the same post cards, never a non-member's.
 * Also: Join with no gym, Leave, the roster opening profiles, no manage / claim control anywhere
 * (GYM-7), a missing gym, and the offline state with Retry. The client is the in-memory fake
 * social client; who may write what was probed live at B50.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import type { FeedPost } from '@/social/feed';
import { GYMS_OFFLINE } from '@/social/gyms';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import GymScreen, { GYM_MISSING } from '@/app/gym/[id]/index';

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

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockGymId = 'rino';
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockGymId }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = SIGNED_IN_USER_ID;
const pat = profile('pat', 'pat_pulls', 'Pat');
const olly = profile('olly', 'olly', 'Olly');
const stranger = profile('stranger', 'stranger_lifts', 'Stranger');
const me = profile(ME, 'me_lifts', 'Me');

const gym = (id: string, name: string) => ({ id, name, address: `${name}, Denver, CO` });
const membership = (userId: string, gymId: string, joinedAt = '2026-11-16T08:00:00.000Z') => ({
  user_id: userId,
  gym_id: gymId,
  joined_at: joinedAt,
});

/** The posts the Gym feed list holds, in order. */
function listedPosts(): FeedPost[] {
  return screen.getByTestId('gym-feed').props.data as FeedPost[];
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockOpenDatabase.mockResolvedValue(await createPreparedDb());
  mockGymId = 'rino';
  mockSocial = createFakeSocialClient({
    profiles: [pat, olly, stranger, me],
    gyms: [gym('rino', 'RiNo'), gym('highlands', 'Highlands')],
    gym_members: [membership('pat', 'rino', '2026-11-16T08:00:00.000Z'), membership('olly', 'rino', '2026-11-16T07:00:00.000Z'), membership('stranger', 'highlands')],
    posts: [
      rawPost({ id: 'pat-post', author: pat, createdAt: '2026-11-15T09:00:00.000Z', title: 'Pat squats' }),
      rawPost({ id: 'olly-post', author: olly, createdAt: '2026-11-15T08:00:00.000Z', title: 'Olly benches' }),
      rawPost({ id: 'stranger-post', author: stranger, createdAt: '2026-11-15T10:00:00.000Z', title: 'Stranger pulls' }),
    ],
  });
});

describe('gym page', () => {
  it('Gym feed works like a Team feed: members’ posts newest first, never a non-member’s; roster opens profiles', async () => {
    await renderSignedIn(<GymScreen />);
    expect(await screen.findByText('Pat squats')).toBeTruthy();
    expect(listedPosts().map((p) => p.id)).toEqual(['pat-post', 'olly-post']);
    expect(screen.queryByText('Stranger pulls')).toBeNull();
    expect(screen.getByText('2 members')).toBeTruthy();
    // The feed is the ordinary posts read narrowed to the members — the Team feed's read.
    const postsRead = mockSocial.requests.find((r) => r[0][1] === 'posts');
    expect(postsRead).toContainEqual(['in', 'user_id', ['pat', 'olly']]);
    await fireEvent.press(screen.getByLabelText("Open Pat's profile"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/profile/[id]', params: { id: 'pat' } });
  });

  it('no gym yet: Join this gym makes me a member (my posts join the feed); Leave takes me out', async () => {
    mockSocial.tables.posts.push(rawPost({ id: 'my-post', author: me, createdAt: '2026-11-15T11:00:00.000Z', title: 'My pulls' }));
    await renderSignedIn(<GymScreen />);
    await fireEvent.press(await screen.findByLabelText('Join this gym'));
    expect(await screen.findByLabelText('Leave gym')).toBeTruthy();
    expect(screen.getByText('3 members')).toBeTruthy();
    expect(await screen.findByText('My pulls')).toBeTruthy();
    expect(mockSocial.tables.gym_members.filter((m) => m.user_id === ME)).toEqual([expect.objectContaining({ gym_id: 'rino' })]);

    await fireEvent.press(screen.getByLabelText('Leave gym'));
    expect(await screen.findByLabelText('Join this gym')).toBeTruthy();
    expect(mockSocial.tables.gym_members.some((m) => m.user_id === ME)).toBe(false);
  });

  it('member elsewhere: Switch asks first naming my gym; confirming switches — still one membership (step DoD)', async () => {
    mockSocial.tables.gym_members.push(membership(ME, 'highlands'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderSignedIn(<GymScreen />);
    await fireEvent.press(await screen.findByLabelText('Switch to this gym'));
    expect(alert.mock.calls[0][0]).toBe('Switch to RiNo?');
    expect(alert.mock.calls[0][1]).toMatch(/out of Highlands/);
    // Nothing changes until the lifter confirms.
    expect(mockSocial.tables.gym_members.find((m) => m.user_id === ME)?.gym_id).toBe('highlands');
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    buttons.find((b) => b.text === 'Switch gyms')?.onPress?.();
    expect(await screen.findByLabelText('Leave gym')).toBeTruthy();
    const mine = mockSocial.tables.gym_members.filter((m) => m.user_id === ME);
    expect(mine).toEqual([expect.objectContaining({ gym_id: 'rino' })]);
    alert.mockRestore();
  });

  it('no settings, claim, edit or manage control exists on a gym page (GYM-7)', async () => {
    mockSocial.tables.gym_members.push(membership(ME, 'rino'));
    await renderSignedIn(<GymScreen />);
    await screen.findByLabelText('Leave gym');
    expect(screen.queryByText(/claim|manage|settings|edit|delete gym/i)).toBeNull();
  });

  it('a gym that doesn’t exist says so', async () => {
    mockGymId = 'nope';
    await renderSignedIn(<GymScreen />);
    expect(await screen.findByText(GYM_MISSING)).toBeTruthy();
  });

  it('offline: the connection message; Retry loads the page', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSocial.setOffline(true);
    await renderSignedIn(<GymScreen />);
    expect(await screen.findByText(GYMS_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.getByText('Pat squats')).toBeTruthy());
    warn.mockRestore();
  });
});
