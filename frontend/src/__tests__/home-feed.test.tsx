/**
 * Tests for the Home feed (B20). The step's definition of done: a followed user's workout post
 * appears on Home, newest first, and a stranger's does not. Also: paging (25 posts → 20, then
 * the other 5, no repeats), pull-to-refresh, the offline state with Retry, and the empty states
 * that lead to Find lifters. The Supabase client is the in-memory fake social client; the
 * router is a stub.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import KeyValueStore from 'expo-sqlite/kv-store';

import type { SqlDriver } from '@/db/driver';
import { replaceFlairsTx } from '@/db/flairs';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { FakeServer } from '@/test-utils/fakeTransport';
import { profile, rawImagePost, rawPost } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';
import { HOT_SOURCE, type FeedPost } from '@/social/feed';
import { feedPrefsKey, resetFeedPrefsCache, serializeFeedPrefs } from '@/social/feedPrefs';

import HomeScreen from '@/app/(tabs)/index';

// B24: the phone's database, for the flair chips — a fresh one per test, holding the four flairs.
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

beforeEach(async () => {
  jest.clearAllMocks();
  const db = await createPreparedDb();
  await db.withTransactionAsync((tx) => replaceFlairsTx(tx, new FakeServer().flairs));
  mockOpenDatabase.mockResolvedValue(db);
  // A fresh install: no remembered feed settings, in memory or on the phone.
  resetFeedPrefsCache();
  await KeyValueStore.removeItem(feedPrefsKey(ME));
});

/** The feed reads (Latest from posts, Hot from the view) in the order they were sent. */
function feedReads() {
  return mockSocial.requests.filter((r) => r[0][1] === 'posts' || r[0][1] === HOT_SOURCE);
}

/** Whether the chip with this spoken label is the lit one. */
function isSelected(label: string): boolean {
  return screen.getByLabelText(label).props.accessibilityState?.selected === true;
}

const HOT = 'Hot posts first, ranked by votes';
const LATEST = 'Latest posts first';
const FORM_CHECK = 'Show only Form Check posts';
const ALL = 'Show posts of every flair';

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

  it('B23: a vote from Home reaches the server and the score the next load reads is the tally', async () => {
    mockSocial = createFakeSocialClient({
      posts: [rawPost({ id: 'lift', author: me, createdAt: '2026-11-15T08:00:00.000Z' })],
      votes: [{ post_id: 'lift', user_id: 'friend', value: 1 }],
    });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByLabelText('Score 1')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Upvote'));
    });
    expect(mockSocial.tables.votes).toContainEqual({ post_id: 'lift', user_id: ME, value: 1 });
    await act(async () => {
      (screen.getByTestId('home-feed').props.refreshControl.props.onRefresh as () => void)();
    });
    expect(await screen.findByLabelText('Score 2')).toBeTruthy();
    expect(listedPosts()[0]).toMatchObject({ score: 2, myVote: 1 });
  });

  it('B23: a Physique Check post on Home has an upvote arrow and no downvote control', async () => {
    mockSocial = createFakeSocialClient({
      posts: [rawImagePost({ id: 'pic', author: me, createdAt: '2026-11-15T09:00:00.000Z', kind: 'progress-pic' })],
    });
    await renderSignedIn(<HomeScreen />);
    await screen.findByLabelText('Flair: Physique Check');
    expect(screen.getByLabelText('Upvote')).toBeTruthy();
    expect(screen.queryByLabelText('Downvote')).toBeNull();
  });

  it('B23: the comments button opens that post’s comments', async () => {
    mockSocial = createFakeSocialClient({
      posts: [rawPost({ id: 'lift', author: me, createdAt: '2026-11-15T08:00:00.000Z' })],
    });
    await renderSignedIn(<HomeScreen />);
    await fireEvent.press(await screen.findByLabelText('Comment'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/post-comments/[id]', params: { id: 'lift' } });
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
    expect(screen.getByLabelText('Who can see this post: Only you')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
  });

  it('B26: the lifter makes their own post private from Home — the server row changes, the card stays', async () => {
    mockSocial = createFakeSocialClient({
      posts: [rawPost({ id: 'lift', author: me, createdAt: '2026-11-15T08:00:00.000Z' })],
    });
    await renderSignedIn(<HomeScreen />);
    await fireEvent.press(await screen.findByLabelText('Who can see this post: Public'));
    await fireEvent.press(screen.getByLabelText('Only you: Only you can see this post'));
    await waitFor(() => expect((mockSocial.tables.posts[0] as { visibility: string }).visibility).toBe('private'));
    expect(mockSocial.requests.some((r) => r.some(([m, arg]) => m === 'update' && JSON.stringify(arg) === '{"visibility":"private"}'))).toBe(true);
    // Still on the owner's own feed, now saying who can see it — and the feed's own list knows,
    // so a card rebuilt after scrolling away says the same.
    expect(screen.getByLabelText('Who can see this post: Only you')).toBeTruthy();
    await waitFor(() => expect(listedPosts()[0].visibility).toBe('private'));
    expect(screen.getByText('Bench Press')).toBeTruthy();
  });

  it('B26: another lifter’s card has no visibility control', async () => {
    mockSocial = createFakeSocialClient({
      profiles: [me, friend],
      follows: [{ follower_id: ME, followee_id: 'friend' }],
      posts: [rawPost({ id: 'theirs', author: friend, createdAt: '2026-11-15T08:00:00.000Z' })],
    });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText('Bench Press')).toBeTruthy();
    expect(screen.queryByLabelText(/^Who can see this post/)).toBeNull();
  });
});

describe('Home feed — order and flair (B24)', () => {
  const FORM = { id: 'form-check', name: 'Form Check' };
  // An older post with ten net upvotes, and two newer ones without — vote sums invert age order.
  function seedRanked() {
    mockSocial = createFakeSocialClient({
      follows: [{ follower_id: ME, followee_id: 'friend' }],
      posts: [
        rawPost({ id: 'popular', author: friend, createdAt: '2026-11-14T08:00:00.000Z' }),
        rawPost({ id: 'fresh', author: friend, createdAt: '2026-11-14T14:00:00.000Z' }),
        rawPost({ id: 'form', author: friend, createdAt: '2026-11-14T13:00:00.000Z', flair: FORM }),
      ],
      votes: Array.from({ length: 10 }, (_, i) => ({ post_id: 'popular', user_id: `fan${i}`, value: 1 })),
    });
  }

  it('starts on Latest with every flair; the chips come from the phone’s flair list', async () => {
    seedRanked();
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout fresh');
    expect(isSelected(LATEST)).toBe(true);
    expect(isSelected(ALL)).toBe(true);
    for (const name of ['WOD', 'Physique Check', 'New PR', 'Form Check']) {
      expect(screen.getByLabelText(`Show only ${name} posts`)).toBeTruthy();
    }
    expect(listedPosts().map((p) => p.id)).toEqual(['fresh', 'form', 'popular']);
    expect(feedReads()).toHaveLength(1);
  });

  it('the toggle switches to the ranked order, read from the hot view (SOC-11)', async () => {
    seedRanked();
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout fresh');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(HOT));
    });
    await screen.findByText('Workout popular');
    expect(listedPosts().map((p) => p.id)).toEqual(['popular', 'fresh', 'form']);
    expect(isSelected(HOT)).toBe(true);
    const last = feedReads().at(-1)!;
    expect(last[0]).toEqual(['from', HOT_SOURCE]);
    expect(last).toContainEqual(['order', 'hot_score', { ascending: false }]);
    // And back again.
    await act(async () => {
      fireEvent.press(screen.getByLabelText(LATEST));
    });
    expect(listedPosts().map((p) => p.id)).toEqual(['fresh', 'form', 'popular']);
  });

  it('selecting a flair shows only matching posts; All brings the rest back (SOC-9)', async () => {
    seedRanked();
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout fresh');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(FORM_CHECK));
    });
    expect(listedPosts().map((p) => p.id)).toEqual(['form']);
    expect(listedPosts().every((p) => p.flair.id === 'form-check')).toBe(true);
    expect(feedReads().at(-1)).toContainEqual(['eq', 'flair_id', 'form-check']);
    expect(isSelected(FORM_CHECK)).toBe(true);
    await act(async () => {
      fireEvent.press(screen.getByLabelText(ALL));
    });
    expect(listedPosts()).toHaveLength(3);
    expect(feedReads().at(-1)!.some(([m, col]) => m === 'eq' && col === 'flair_id')).toBe(false);
  });

  it('the order and flair survive a relaunch: the first read after reopening already uses them (step DoD)', async () => {
    seedRanked();
    const first = await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout fresh');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(HOT));
    });
    await screen.findByText('Workout popular');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(FORM_CHECK));
    });
    await waitFor(() => expect(listedPosts().map((p) => p.id)).toEqual(['form']));
    await first.unmount();
    // Relaunch: the app's memory is gone; only what the phone saved remains.
    resetFeedPrefsCache();
    mockSocial.requests.length = 0;
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout form');
    expect(feedReads()).toHaveLength(1);
    expect(feedReads()[0][0]).toEqual(['from', HOT_SOURCE]);
    expect(feedReads()[0]).toContainEqual(['eq', 'flair_id', 'form-check']);
    expect(isSelected(HOT)).toBe(true);
    expect(isSelected(FORM_CHECK)).toBe(true);
  });

  it('Hot and a flair compose, and the next page keeps both', async () => {
    const posts = Array.from({ length: 25 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      return rawPost({ id: `f${n}`, author: friend, createdAt: `2026-11-14T${n}:00:00.000Z`, flair: FORM });
    });
    posts.push(rawPost({ id: 'wod', author: friend, createdAt: '2026-11-15T09:00:00.000Z' }));
    mockSocial = createFakeSocialClient({ follows: [{ follower_id: ME, followee_id: 'friend' }], posts });
    await KeyValueStore.setItem(feedPrefsKey(ME), serializeFeedPrefs({ sort: 'hot', flairId: 'form-check' }));
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout f24');
    expect(listedPosts()).toHaveLength(20);
    await act(async () => {
      fireEvent(screen.getByTestId('home-feed'), 'onEndReached');
    });
    expect(listedPosts()).toHaveLength(25);
    expect(listedPosts().map((p) => p.id)).not.toContain('wod');
    const pageTwo = feedReads().at(-1)!;
    expect(pageTwo[0]).toEqual(['from', HOT_SOURCE]);
    expect(pageTwo).toContainEqual(['eq', 'flair_id', 'form-check']);
    expect(pageTwo.some(([m, f]) => m === 'or' && String(f).startsWith('hot_score.lt.'))).toBe(true);
  });

  it('an empty filtered feed names the flair and offers the whole feed back', async () => {
    seedRanked();
    await KeyValueStore.setItem(feedPrefsKey(ME), serializeFeedPrefs({ sort: 'latest', flairId: 'new-pr' }));
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText('No New PR posts yet.')).toBeTruthy();
    expect(screen.queryByText(/Nobody you follow has posted yet/)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Show all posts'));
    });
    expect(listedPosts()).toHaveLength(3);
    expect(isSelected(ALL)).toBe(true);
  });

  it('a remembered flair the phone no longer lists reads as All — never an invisible filter', async () => {
    seedRanked();
    await KeyValueStore.setItem(feedPrefsKey(ME), serializeFeedPrefs({ sort: 'latest', flairId: 'retired-flair' }));
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout fresh');
    expect(listedPosts()).toHaveLength(3);
    expect(isSelected(ALL)).toBe(true);
    expect(feedReads()[0].some(([m, col]) => m === 'eq' && col === 'flair_id')).toBe(false);
  });

  it('tapping the already-lit chip while a stale flair is remembered keeps the feed showing', async () => {
    seedRanked();
    await KeyValueStore.setItem(feedPrefsKey(ME), serializeFeedPrefs({ sort: 'latest', flairId: 'retired-flair' }));
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout fresh');
    await act(async () => {
      fireEvent.press(screen.getByLabelText(LATEST));
    });
    expect(screen.queryByText('Loading your feed…')).toBeNull();
    expect(listedPosts()).toHaveLength(3);
  });

  it('another account on the same phone does not inherit this one’s choice', async () => {
    seedRanked();
    await KeyValueStore.setItem(feedPrefsKey('someone-else'), serializeFeedPrefs({ sort: 'hot', flairId: 'form-check' }));
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('Workout fresh');
    expect(isSelected(LATEST)).toBe(true);
    expect(feedReads()[0][0]).toEqual(['from', 'posts']);
  });
});

describe('Home — Your groups (B36 Teams, B50 Gym: TEAM-2, GYM-2, SOC-10)', () => {
  const team = (id: string, name: string) => ({ id, name, join_mode: 'open', created_by: 'friend', created_at: '2026-11-15T10:00:00.000Z' });

  it('shows a chip per team that opens its page (the Team feed), and an invite chip to Communities', async () => {
    mockSocial = createFakeSocialClient({
      teams: [team('t1', 'Dawn Patrol'), team('t2', 'Iron Circle')],
      team_members: [{ team_id: 't1', user_id: ME, role: 'member', joined_at: '2026-11-15T11:00:00.000Z' }],
      team_invites: [{ team_id: 't2', user_id: ME }],
    });
    await renderSignedIn(<HomeScreen />);
    await fireEvent.press(await screen.findByLabelText('Open team Dawn Patrol'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team/[id]', params: { id: 't1' } });
    await fireEvent.press(screen.getByLabelText('1 team invite'));
    expect(mockPush).toHaveBeenCalledWith('/communities');
  });

  it('no gym, no teams and no invites → no group row at all', async () => {
    mockSocial = createFakeSocialClient({
      posts: [rawPost({ id: 'mine', author: me, createdAt: '2026-11-15T10:00:00.000Z', title: 'My session' })],
    });
    await renderSignedIn(<HomeScreen />);
    await screen.findByText('My session');
    expect(screen.queryByText('Your groups')).toBeNull();
  });

  it('a gym alone shows the row: its chip comes first and opens the gym page (the Gym feed) — SOC-10', async () => {
    mockSocial = createFakeSocialClient({
      teams: [team('t1', 'Dawn Patrol')],
      team_members: [{ team_id: 't1', user_id: ME, role: 'member', joined_at: '2026-11-15T11:00:00.000Z' }],
      gyms: [{ id: 'g1', name: 'Sample Gym · RiNo', address: 'River North, Denver, CO' }],
      gym_members: [{ user_id: ME, gym_id: 'g1', joined_at: '2026-11-16T09:00:00.000Z' }],
    });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByText('Your groups')).toBeTruthy();
    const gymChip = await screen.findByLabelText('Open your gym Sample Gym · RiNo');
    await screen.findByLabelText('Open team Dawn Patrol');
    // The gym chip is first in the row.
    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel as string | undefined);
    expect(labels.indexOf('Open your gym Sample Gym · RiNo')).toBeLessThan(labels.indexOf('Open team Dawn Patrol'));
    await fireEvent.press(gymChip);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/gym/[id]', params: { id: 'g1' } });
  });

  it('a gym with no teams still shows the row', async () => {
    mockSocial = createFakeSocialClient({
      gyms: [{ id: 'g1', name: 'Sample Gym · RiNo', address: 'River North, Denver, CO' }],
      gym_members: [{ user_id: ME, gym_id: 'g1', joined_at: '2026-11-16T09:00:00.000Z' }],
    });
    await renderSignedIn(<HomeScreen />);
    expect(await screen.findByLabelText('Open your gym Sample Gym · RiNo')).toBeTruthy();
    expect(screen.getByText('Your groups')).toBeTruthy();
  });
});
