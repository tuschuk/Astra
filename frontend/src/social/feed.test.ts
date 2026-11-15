/**
 * Tests for reading the Home feed (B20, SOC-1): whose posts it asks for, the exact request it
 * builds, bookmark paging (no repeats, no gaps, ties broken by id), and shaping the server's
 * nested reply into the card's typed post. B24: the Latest / Hot orders (SOC-11) and the flair
 * filter (SOC-9). Runs against the in-memory fake social client.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { feedSet, profile, rawImagePost, rawPost } from '@/test-utils/feedFixtures';

import {
  appendPage,
  beforeCursorFilter,
  beforeHotCursorFilter,
  FEED_PAGE_SIZE,
  FEED_SELECT,
  feedAuthorIds,
  HOT_SOURCE,
  loadFeedPage,
  SCORES_SELECT,
  toFeedPost,
  type FeedPost,
  type HotFeedCursor,
  type LatestFeedCursor,
} from './feed';

const ME = 'me';
const me = profile(ME, 'me_lifts');
const friend = profile('friend', 'friend', 'Friendly Lifter');
const stranger = profile('stranger', 'stranger');

describe('beforeCursorFilter', () => {
  it('means "earlier time, or the same time and a smaller id", with the time quoted', () => {
    expect(beforeCursorFilter({ created_at: '2026-11-15T09:00:00.5+00:00', id: 'p9' })).toBe(
      'created_at.lt."2026-11-15T09:00:00.5+00:00",and(created_at.eq."2026-11-15T09:00:00.5+00:00",id.lt.p9)',
    );
  });
});

describe('feedAuthorIds', () => {
  it('is me plus everyone I follow (and only follows where I am the follower)', async () => {
    const { client } = createFakeSocialClient({
      follows: [
        { follower_id: ME, followee_id: 'friend' },
        { follower_id: 'stranger', followee_id: ME },
      ],
    });
    expect(await feedAuthorIds(client, ME)).toEqual([ME, 'friend']);
  });

  it('is just me when I follow nobody', async () => {
    const { client } = createFakeSocialClient();
    expect(await feedAuthorIds(client, ME)).toEqual([ME]);
  });

  it('throws when the request fails (no connection)', async () => {
    const { client } = createFakeSocialClient({}, { offline: true });
    await expect(feedAuthorIds(client, ME)).rejects.toThrow('Loading who you follow failed');
  });
});

describe('loadFeedPage', () => {
  it('asks for the authors’ posts with the full embed, my vote only, newest first, one page — then their scores', async () => {
    const { client, requests } = createFakeSocialClient({
      posts: [rawPost({ id: 'lift', author: friend, createdAt: '2026-11-15T08:00:00.000Z' })],
    });
    await loadFeedPage(client, ME, [ME, 'friend'], 'latest', null, null);
    expect(requests[0]).toEqual([
      ['from', 'posts'],
      ['select', FEED_SELECT],
      ['in', 'user_id', [ME, 'friend']],
      // B23: the filter names the embed's alias, not the votes table.
      ['eq', 'my_vote.user_id', ME],
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', FEED_PAGE_SIZE],
    ]);
    expect(requests[1]).toEqual([
      ['from', 'post_scores'],
      ['select', SCORES_SELECT],
      ['in', 'post_id', ['lift']],
    ]);
    expect(FEED_SELECT).toContain('flair:flairs(id,name,upvotes_only)');
    expect(FEED_SELECT).toContain('my_vote:votes(value)');
    // B22: a plain (left) embed — an inner join would hide every photo post (no workout).
    expect(FEED_SELECT).toContain('workout:workouts(');
    expect(FEED_SELECT).not.toContain('!inner');
    expect(FEED_SELECT).toMatch(/^id,created_at,kind,image_path,visibility,/);
  });

  it('B23: each post carries the tally of everyone’s votes, its comment count, and only my own vote', async () => {
    const { client } = createFakeSocialClient({
      posts: [
        rawPost({ id: 'busy', author: friend, createdAt: '2026-11-15T09:00:00.000Z' }),
        rawPost({ id: 'quiet', author: friend, createdAt: '2026-11-15T08:00:00.000Z' }),
      ],
      votes: [
        { post_id: 'busy', user_id: 'a', value: 1 },
        { post_id: 'busy', user_id: 'b', value: 1 },
        { post_id: 'busy', user_id: ME, value: -1 },
        { post_id: 'quiet', user_id: 'a', value: -1 },
      ],
      comments: [
        { id: 'c1', post_id: 'busy', user_id: 'a', body: 'hi', created_at: '2026-11-15T09:10:00.000Z' },
        { id: 'c2', post_id: 'busy', user_id: 'b', body: 'yo', created_at: '2026-11-15T09:20:00.000Z' },
      ],
    });
    const page = await loadFeedPage(client, ME, ['friend'], 'latest', null, null);
    expect(page.posts.map((p) => [p.id, p.score, p.commentCount, p.myVote])).toEqual([
      ['busy', 1, 2, -1],
      ['quiet', -1, 0, null],
    ]);
  });

  it('B23: the scores request fails → the page fails (no half-scored feed)', async () => {
    const fake = createFakeSocialClient({ posts: [rawPost({ id: 'x', author: me, createdAt: '2026-11-15T08:00:00.000Z' })] });
    const real = fake.client.from.bind(fake.client);
    (fake.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === 'post_scores') fake.setOffline(true);
      return real(t as never);
    };
    await expect(loadFeedPage(fake.client, ME, [ME], 'latest', null, null)).rejects.toThrow('Loading the scores failed');
  });

  it('B22: photo posts come through beside workout posts; a workout post whose workout was withheld is dropped', async () => {
    const hidden = { ...rawPost({ id: 'hidden', author: friend, createdAt: '2026-11-15T07:00:00.000Z' }), workout: null };
    const { client } = createFakeSocialClient({
      posts: [
        rawImagePost({ id: 'pic', author: me, createdAt: '2026-11-15T09:00:00.000Z', kind: 'progress-pic' }),
        rawImagePost({ id: 'pr', author: friend, createdAt: '2026-11-15T08:30:00.000Z', kind: 'pr' }),
        rawPost({ id: 'lift', author: friend, createdAt: '2026-11-15T08:00:00.000Z' }),
        hidden,
      ],
    });
    const page = await loadFeedPage(client, ME, [ME, 'friend'], 'latest', null, null);
    expect(page.posts.map((p) => [p.id, p.kind])).toEqual([
      ['pic', 'progress-pic'],
      ['pr', 'pr'],
      ['lift', 'workout'],
    ]);
  });

  it('shows the followed user’s posts newest first, and never a stranger’s (step DoD)', async () => {
    const { client } = createFakeSocialClient({
      posts: [
        rawPost({ id: 'old', author: friend, createdAt: '2026-11-14T08:00:00.000Z' }),
        rawPost({ id: 'stranger-post', author: stranger, createdAt: '2026-11-15T09:00:00.000Z' }),
        rawPost({ id: 'new', author: friend, createdAt: '2026-11-15T08:00:00.000Z' }),
      ],
    });
    const page = await loadFeedPage(client, ME, [ME, 'friend'], 'latest', null, null);
    expect(page.posts.map((p) => p.id)).toEqual(['new', 'old']);
    expect(page.next).toBeNull();
  });

  it('pages by bookmark: 25 posts → 20, then the other 5, no repeats, ties broken by id', async () => {
    // Five posts share one timestamp, straddling the page boundary.
    const posts = Array.from({ length: 25 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      const createdAt = i >= 17 && i <= 21 ? '2026-11-15T00:00:00.000Z' : `2026-11-15T${n}:30:00.000Z`;
      return rawPost({ id: `p${n}`, author: friend, createdAt });
    });
    const { client, requests } = createFakeSocialClient({ posts });
    const first = await loadFeedPage(client, ME, ['friend'], 'latest', null, null);
    expect(first.posts).toHaveLength(FEED_PAGE_SIZE);
    expect(first.next).not.toBeNull();
    const second = await loadFeedPage(client, ME, ['friend'], 'latest', null, first.next);
    expect(second.posts).toHaveLength(5);
    expect(second.next).toBeNull();
    const all = [...first.posts, ...second.posts].map((p) => p.id);
    expect(new Set(all).size).toBe(25);
    // requests: posts, scores, posts (page two), scores.
    expect(first.next).toMatchObject({ sort: 'latest' });
    expect(requests[2]).toContainEqual(['or', beforeCursorFilter(first.next as LatestFeedCursor)]);
  });

  it('makes no request for an empty author list', async () => {
    const { client, requests } = createFakeSocialClient();
    expect(await loadFeedPage(client, ME, [], 'latest', null, null)).toEqual({ posts: [], next: null });
    expect(requests).toHaveLength(0);
  });

  it('throws when the request fails', async () => {
    const { client } = createFakeSocialClient({}, { offline: true });
    await expect(loadFeedPage(client, ME, [ME], 'latest', null, null)).rejects.toThrow('Loading the feed failed');
  });
});

describe('beforeHotCursorFilter (B24)', () => {
  it('means "a lower hot score, or the same score and a smaller id", the score echoed as sent', () => {
    expect(beforeHotCursorFilter({ hot_score: 14682.5330302897, id: 'p9' })).toBe(
      'hot_score.lt.14682.5330302897,and(hot_score.eq.14682.5330302897,id.lt.p9)',
    );
  });
});

describe('loadFeedPage — order and flair (B24)', () => {
  // A friend's post that drew ten net upvotes (worth 12.5 h of freshness), and two posts six and
  // five hours newer with none.
  const seeded = () =>
    createFakeSocialClient({
      posts: [
        rawPost({ id: 'popular-old', author: friend, createdAt: '2026-11-14T08:00:00.000Z' }),
        rawPost({ id: 'quiet-new', author: friend, createdAt: '2026-11-14T14:00:00.000Z' }),
        rawPost({ id: 'form', author: friend, createdAt: '2026-11-14T13:00:00.000Z', flair: { id: 'form-check', name: 'Form Check' } }),
      ],
      votes: Array.from({ length: 12 }, (_, i) => ({ post_id: 'popular-old', user_id: `fan${i}`, value: 1 })).concat([
        { post_id: 'popular-old', user_id: 'hater1', value: -1 },
        { post_id: 'popular-old', user_id: 'hater2', value: -1 },
      ]),
    });

  it('Hot reads the ranking view with the feed’s own select plus the score, ranked highest first', async () => {
    const { client, requests } = seeded();
    await loadFeedPage(client, ME, [ME, 'friend'], 'hot', null, null);
    expect(requests[0]).toEqual([
      ['from', HOT_SOURCE],
      ['select', `${FEED_SELECT},hot_score`],
      ['in', 'user_id', [ME, 'friend']],
      ['eq', 'my_vote.user_id', ME],
      ['order', 'hot_score', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['limit', FEED_PAGE_SIZE],
    ]);
    // The card's tally still comes from post_scores, exactly as in Latest.
    expect(requests[1][0]).toEqual(['from', 'post_scores']);
  });

  it('the toggle changes the results: Latest is newest first, Hot lifts the well-voted older post', async () => {
    const { client } = seeded();
    const latest = await loadFeedPage(client, ME, ['friend'], 'latest', null, null);
    const hot = await loadFeedPage(client, ME, ['friend'], 'hot', null, null);
    expect(latest.posts.map((p) => p.id)).toEqual(['quiet-new', 'form', 'popular-old']);
    expect(hot.posts.map((p) => p.id)).toEqual(['popular-old', 'quiet-new', 'form']);
    expect(hot.posts[0].score).toBe(10);
  });

  it('Hot with no votes anywhere reads newest first', async () => {
    const { client } = createFakeSocialClient({
      posts: [
        rawPost({ id: 'a', author: friend, createdAt: '2026-11-13T08:00:00.000Z' }),
        rawPost({ id: 'c', author: friend, createdAt: '2026-11-15T08:00:00.000Z' }),
        rawPost({ id: 'b', author: friend, createdAt: '2026-11-14T08:00:00.000Z' }),
      ],
    });
    const page = await loadFeedPage(client, ME, ['friend'], 'hot', null, null);
    expect(page.posts.map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('a flair adds one clause and only matching posts come back, in either order (SOC-9)', async () => {
    for (const sort of ['latest', 'hot'] as const) {
      const { client, requests } = seeded();
      const page = await loadFeedPage(client, ME, ['friend'], sort, 'form-check', null);
      expect(page.posts.map((p) => p.id)).toEqual(['form']);
      expect(page.posts.every((p) => p.flair.id === 'form-check')).toBe(true);
      expect(requests[0]).toContainEqual(['eq', 'flair_id', 'form-check']);
    }
    // No flair, no clause.
    const { client, requests } = seeded();
    await loadFeedPage(client, ME, ['friend'], 'latest', null, null);
    expect(requests[0].some(([m, col]) => m === 'eq' && col === 'flair_id')).toBe(false);
  });

  it('pages Hot by its own bookmark: 25 posts → 20, then 5, no repeats, ties broken by id, flair kept', async () => {
    // Ten posts share a timestamp (and so a score), straddling the page boundary.
    const posts = Array.from({ length: 25 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      const createdAt = i >= 3 && i <= 12 ? '2026-11-15T00:00:00.000Z' : `2026-11-15T${n}:30:00.000Z`;
      return rawPost({ id: `p${n}`, author: friend, createdAt, flair: { id: 'form-check', name: 'Form Check' } });
    });
    const { client, requests } = createFakeSocialClient({ posts });
    const first = await loadFeedPage(client, ME, ['friend'], 'hot', 'form-check', null);
    expect(first.posts).toHaveLength(FEED_PAGE_SIZE);
    expect(first.next).toMatchObject({ sort: 'hot', id: first.posts[19].id });
    const second = await loadFeedPage(client, ME, ['friend'], 'hot', 'form-check', first.next);
    expect(second.posts).toHaveLength(5);
    expect(second.next).toBeNull();
    expect(new Set([...first.posts, ...second.posts].map((p) => p.id)).size).toBe(25);
    // requests: hot, scores, hot (page two), scores — page two keeps both clauses.
    expect(requests[2]).toContainEqual(['or', beforeHotCursorFilter(first.next as HotFeedCursor)]);
    expect(requests[2]).toContainEqual(['eq', 'flair_id', 'form-check']);
  });

  it('refuses a bookmark from the other order rather than return a wrong page', async () => {
    const { client, requests } = seeded();
    const latestCursor: LatestFeedCursor = { sort: 'latest', created_at: '2026-11-15T00:00:00.000Z', id: 'x' };
    await expect(loadFeedPage(client, ME, ['friend'], 'hot', null, latestCursor)).rejects.toThrow(
      "A latest bookmark can't continue the hot feed",
    );
    expect(requests).toHaveLength(0);
  });

  it('names the author relationship, which the live server needs through the view', async () => {
    expect(FEED_SELECT).toContain('author:profiles!posts_user_id_fkey(id,username,display_name,avatar_url)');
    // The fake reproduces the live refusal of the bare name on the view.
    const { client } = seeded();
    const { error } = await client.from(HOT_SOURCE).select('id,author:profiles(id)');
    expect(error?.code).toBe('PGRST201');
  });
});

describe('toFeedPost', () => {
  it('sorts exercises and sets into order, makes weights numbers, and keeps the flair row’s name', () => {
    const raw = rawPost({
      id: 'p1',
      author: me,
      createdAt: '2026-11-15T08:00:00.000Z',
      flair: { id: 'some-new-flair', name: 'Deload Day' },
      entries: [
        { name: 'Squat', sets: [feedSet({ position: 2, reps: 3 }), feedSet({ position: 1, reps: 5 })] },
        { name: null, sets: [] },
      ],
    });
    raw.workout.workout_exercises.reverse();
    raw.workout.workout_exercises[1].sets[0].weight_kg = '102.5' as unknown as number;
    const post = toFeedPost(raw);
    if (post?.kind !== 'workout') throw new Error('expected a workout post');
    expect(post.flair).toEqual({ id: 'some-new-flair', name: 'Deload Day', upvotesOnly: false });
    expect(post.workout.entries.map((e) => e.exerciseName)).toEqual(['Squat', null]);
    expect(post.workout.entries[0].sets.map((s) => s.reps)).toEqual([5, 3]);
    expect(post.workout.entries[0].sets[1].weight_kg).toBe(102.5);
    expect(post.author).toEqual({ id: ME, username: 'me_lifts', displayName: null, avatarPath: null });
  });

  it('B25: carries the author’s photo path for the avatar', () => {
    const raw = rawPost({ id: 'p1', author: { ...me, avatar_url: `${ME}/face.jpg` }, createdAt: '2026-11-15T08:00:00.000Z' });
    expect(toFeedPost(raw)?.author.avatarPath).toBe(`${ME}/face.jpg`);
  });

  it('fills in a missing flair or author instead of crashing', () => {
    const raw = { ...rawPost({ id: 'p1', author: me, createdAt: '2026-11-15T08:00:00.000Z' }), flair: null, author: null };
    const post = toFeedPost(raw);
    expect(post?.flair.name).toBe('Post');
    expect(post?.author).toEqual({ id: '', username: null, displayName: null, avatarPath: null });
  });

  it('B22: shapes a photo post (kind, photo path, visibility, flair) and drops one with no photo', () => {
    const raw = rawImagePost({ id: 'pic', author: me, createdAt: '2026-11-15T08:00:00.000Z', kind: 'progress-pic' });
    expect(toFeedPost(raw)).toEqual({
      id: 'pic',
      createdAt: '2026-11-15T08:00:00.000Z',
      kind: 'progress-pic',
      imagePath: `${ME}/pic.jpg`,
      visibility: 'private',
      flair: { id: 'physique-check', name: 'Physique Check', upvotesOnly: true },
      author: { id: ME, username: 'me_lifts', displayName: null, avatarPath: null },
      score: 0,
      commentCount: 0,
      myVote: null,
    });
    expect(toFeedPost({ ...raw, image_path: null })).toBeNull();
  });

  it('B23: reads the flair row’s upvotes_only flag, the scores row, and my vote; a missing flag or scores row reads as the quiet default', () => {
    const raw = {
      ...rawPost({ id: 'p1', author: me, createdAt: '2026-11-15T08:00:00.000Z', flair: { id: 'zz', name: 'Zz', upvotes_only: true } }),
      my_vote: [{ value: 1 }],
    };
    const post = toFeedPost(raw, { post_id: 'p1', score: 7, comment_count: 3 });
    expect(post).toMatchObject({ flair: { upvotesOnly: true }, score: 7, commentCount: 3, myVote: 1 });
    const bare = toFeedPost({ ...raw, flair: { id: 'zz', name: 'Zz' }, my_vote: undefined });
    expect(bare).toMatchObject({ flair: { upvotesOnly: false }, score: 0, commentCount: 0, myVote: null });
    expect(toFeedPost({ ...raw, my_vote: [{ value: 5 }] })?.myVote).toBeNull();
  });

  it('B22: drops a workout post whose workout the viewer may not see (no empty card)', () => {
    const raw = { ...rawPost({ id: 'p1', author: friend, createdAt: '2026-11-15T08:00:00.000Z' }), workout: null };
    expect(toFeedPost(raw)).toBeNull();
  });
});

describe('appendPage', () => {
  it('adds a page after the shown posts, skipping any already shown', () => {
    const make = (id: string) => ({ id }) as FeedPost;
    expect(appendPage([make('a'), make('b')], [make('b'), make('c')]).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
