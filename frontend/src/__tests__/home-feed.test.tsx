/**
 * Tests for the Home feed (B20). The step's definition of done: a followed user's workout post
 * appears on Home, newest first, and a stranger's does not. Also: paging (25 posts → 20, then
 * the other 5, no repeats), pull-to-refresh, the offline state with Retry, and the empty states
 * that lead to Find lifters. The Supabase client is the in-memory fake social client; the
 * router is a stub.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawImagePost, rawPost } from '@/test-utils/feedFixtures';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';
import type { FeedPost } from '@/social/feed';
import { ONLY_YOU_LINE } from '@/components/social/PostCard';

import HomeScreen from '@/app/(tabs)/index';

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = SIGNED_IN_USER_ID;
const me = profile(ME, 'me_lifts', 'Me');
const friend = profile('friend', 'friend_lifts', 'Friendly');
const stranger = profile('stranger', 'stranger_lifts', 'Stranger');

beforeEach(() => {
  jest.clearAllMocks();
});

/** The posts the feed list currently holds, in order (virtualization-proof). */
function listedPosts(): FeedPost[] {
  return screen.getByTestId('home-feed').props.data as FeedPost[];
}

describe('Home feed', () => {
  it('shows a followed user’s posts newest first, and never a stranger’s (step DoD)', async () => {
    mockSocial = createFakeSocialClient({
      profiles: [me, friend, stranger],
      follows: [{ follower_id: ME, followee_id: 'friend' }],
      posts: [
        rawPost({ id: 'older', author: friend, createdAt: '2026-11-13T10:00:00.000Z', title: 'Friend older' }),
        rawPost({ id: 'stranger', author: stranger, createdAt: '2026-11-15T12:00:00.000Z', title: 'Stranger session' }),
        rawPost({ id: 'newer', author: friend, createdAt: '2026-11-14T10:00:00.000Z', title: 'Friend newer' }),
      ],
    });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText('Friend newer')).toBeTruthy();
    const titles = screen.getAllByText(/^Friend (newer|older)$/).map((n) => n.props.children);
    expect(titles).toEqual(['Friend newer', 'Friend older']);
    expect(screen.queryByText('Stranger session')).toBeNull();
    expect(listedPosts().map((p) => p.id)).toEqual(['newer', 'older']);
  });

  it('includes my own posts in my feed', async () => {
    mockSocial = createFakeSocialClient({
      posts: [rawPost({ id: 'mine', author: me, createdAt: '2026-11-15T10:00:00.000Z', title: 'My session' })],
    });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText('My session')).toBeTruthy();
  });

  it('pages: 25 posts → the first 20, then scrolling to the end loads the other 5, no repeats', async () => {
    const posts = Array.from({ length: 25 }, (_, i) =>
      rawPost({ id: `p${String(i).padStart(2, '0')}`, author: friend, createdAt: `2026-11-14T${String(i).padStart(2, '0')}:00:00.000Z` }),
    );
    mockSocial = createFakeSocialClient({ follows: [{ follower_id: ME, followee_id: 'friend' }], posts });
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout p24');
    expect(listedPosts()).toHaveLength(20);
    await act(async () => {
      fireEvent(screen.getByTestId('home-feed'), 'onEndReached');
    });
    expect(listedPosts()).toHaveLength(25);
    expect(new Set(listedPosts().map((p) => p.id)).size).toBe(25);
    expect(listedPosts()[24].id).toBe('p00');
    // The last page was short: scrolling again asks for nothing more.
    const before = mockSocial.requests.length;
    await act(async () => {
      fireEvent(screen.getByTestId('home-feed'), 'onEndReached');
    });
    expect(mockSocial.requests.length).toBe(before);
  });

  it('two quick “reached the end” signals ask for the next page once', async () => {
    const posts = Array.from({ length: 25 }, (_, i) =>
      rawPost({ id: `q${String(i).padStart(2, '0')}`, author: me, createdAt: `2026-11-14T${String(i).padStart(2, '0')}:00:00.000Z` }),
    );
    mockSocial = createFakeSocialClient({ posts });
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout q24');
    const postRequests = () => mockSocial.requests.filter((r) => r[0][1] === 'posts').length;
    const before = postRequests();
    await act(async () => {
      fireEvent(screen.getByTestId('home-feed'), 'onEndReached');
      fireEvent(screen.getByTestId('home-feed'), 'onEndReached');
    });
    expect(postRequests()).toBe(before + 1);
    expect(listedPosts()).toHaveLength(25);
  });

  it('pull-to-refresh brings in a post made since the feed loaded', async () => {
    mockSocial = createFakeSocialClient({
      follows: [{ follower_id: ME, followee_id: 'friend' }],
      posts: [rawPost({ id: 'a', author: friend, createdAt: '2026-11-14T10:00:00.000Z', title: 'First' })],
    });
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('First');
    mockSocial.tables.posts.push(rawPost({ id: 'b', author: friend, createdAt: '2026-11-15T10:00:00.000Z', title: 'Fresh' }));
    await act(async () => {
      (screen.getByTestId('home-feed').props.refreshControl.props.onRefresh as () => void)();
    });
    expect(await screen.findByText('Fresh')).toBeTruthy();
    expect(listedPosts().map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('offline: says the feed needs a connection, and Retry loads it once back online', async () => {
    mockSocial = createFakeSocialClient(
      { posts: [rawPost({ id: 'a', author: me, createdAt: '2026-11-14T10:00:00.000Z', title: 'Back online' })] },
      { offline: true },
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText(/The feed needs a connection/)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Back online')).toBeTruthy();
    warn.mockRestore();
  });

  it('following nobody: invites finding lifters or logging a workout', async () => {
    mockSocial = createFakeSocialClient();
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText(/Find people to follow/)).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText('Find lifters')[1]);
    expect(mockPush).toHaveBeenCalledWith('/find-lifters');
    await fireEvent.press(screen.getByLabelText('Log a workout'));
    expect(mockPush).toHaveBeenCalledWith('/workout');
  });

  it('following people who haven’t posted: says so', async () => {
    mockSocial = createFakeSocialClient({ follows: [{ follower_id: ME, followee_id: 'friend' }] });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText(/Nobody you follow has posted yet/)).toBeTruthy();
  });

  it('the header’s Find lifters button opens the search', async () => {
    mockSocial = createFakeSocialClient();
    await renderSignedIn(<HomeScreen />);
    await screen.findByText(/Find people to follow/);
    await fireEvent.press(screen.getAllByLabelText('Find lifters')[0]);
    expect(mockPush).toHaveBeenCalledWith('/find-lifters');
  });

  it('B22: the header’s Share a photo button opens the photo post screen', async () => {
    mockSocial = createFakeSocialClient();
    await renderSignedIn(<HomeScreen />);
    await screen.findByText(/Find people to follow/);
    await fireEvent.press(screen.getByLabelText('Share a photo'));
    expect(mockPush).toHaveBeenCalledWith('/new-post');
  });

  it('B22: photo posts render on Home beside workout posts, the owner’s progress pic marked private', async () => {
    mockSocial = createFakeSocialClient({
      posts: [
        rawImagePost({ id: 'pic', author: profile(SIGNED_IN_USER_ID, 'me'), createdAt: '2026-11-15T09:00:00.000Z', kind: 'progress-pic' }),
        rawPost({ id: 'lift', author: profile(SIGNED_IN_USER_ID, 'me'), createdAt: '2026-11-15T08:00:00.000Z' }),
      ],
    });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByLabelText('Flair: Physique Check')).toBeTruthy();
    expect(screen.getByText(ONLY_YOU_LINE)).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
  });
});
