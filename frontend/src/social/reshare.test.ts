/**
 * Tests for re-sharing a post (SOC-6, B28): the exact row inserted, re-sharing a re-share passes
 * on the original (plan G4), and the server's refusals turned into the card's typed results —
 * a second re-share (23505) is "already re-shared", anything else (no signal, refused) "failed".
 * Runs against the in-memory fake social client; the server's own re-share rules (chains, self
 * re-shares, the flair stamp, visibility) were probed live.
 */
import { describe, expect, it } from '@jest/globals';

import { toFeedPost, type FeedPost } from '@/social/feed';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost, rawReshare } from '@/test-utils/feedFixtures';

import { RESHARE_MESSAGES, resharePost, reshareTarget } from './reshare';

const ME = 'me';
const alice = profile('alice', 'alice');
const bob = profile('bob', 'bob');
const NOW = new Date('2026-11-15T18:00:00.000Z');
const PHYSIQUE = { id: 'physique-check', name: 'Physique Check', upvotes_only: true };

const original = rawPost({ id: 'orig', author: alice, createdAt: '2026-11-15T08:00:00.000Z', flair: PHYSIQUE });

/** The original in the card's shape. */
function originalPost(): FeedPost {
  const post = toFeedPost(original);
  if (!post) throw new Error('expected a post');
  return post;
}

/** Bob's re-share of the original, in the card's shape. */
function bobsReshare(): FeedPost {
  const raw = rawReshare({ id: 'bob-rs', author: bob, createdAt: '2026-11-15T09:00:00.000Z', original: { id: 'orig', flair: PHYSIQUE } });
  const post = toFeedPost(raw, undefined, new Map([['orig', original]]));
  if (post?.kind !== 'reshare') throw new Error('expected a re-share');
  return post;
}

describe('reshareTarget', () => {
  it('is the post itself on an ordinary card, and the original on a re-share card (no chains)', () => {
    expect(reshareTarget(originalPost())).toEqual({ id: 'orig', flairId: 'physique-check' });
    expect(reshareTarget(bobsReshare())).toEqual({ id: 'orig', flairId: 'physique-check' });
  });
});

describe('resharePost', () => {
  it('inserts one public re-share row pointing at the original, wearing its flair', async () => {
    const { client, tables } = createFakeSocialClient({ posts: [original] });
    const result = await resharePost(client, ME, originalPost(), NOW);
    expect(result.ok).toBe(true);
    const row = (tables.posts as Record<string, unknown>[]).find((p) => p.kind === 'reshare');
    expect(row).toEqual({
      id: result.ok ? result.id : '',
      user_id: ME,
      kind: 'reshare',
      shared_post_id: 'orig',
      flair_id: 'physique-check',
      visibility: 'public',
      created_at: NOW.toISOString(),
    });
  });

  it('re-sharing a re-share card re-shares the original', async () => {
    const { client, tables } = createFakeSocialClient({ posts: [original] });
    await resharePost(client, ME, bobsReshare(), NOW);
    expect((tables.posts as Record<string, unknown>[]).filter((p) => p.kind === 'reshare').map((p) => p.shared_post_id)).toEqual([
      'orig',
    ]);
  });

  it('a second re-share of the same post is "already re-shared" and adds no row', async () => {
    const { client, tables } = createFakeSocialClient({ posts: [original] });
    expect((await resharePost(client, ME, originalPost(), NOW)).ok).toBe(true);
    expect(await resharePost(client, ME, originalPost(), NOW)).toEqual({ ok: false, reason: 'already-reshared' });
    expect((tables.posts as Record<string, unknown>[]).filter((p) => p.kind === 'reshare')).toHaveLength(1);
  });

  it('no connection is "failed"; it never throws', async () => {
    const { client } = createFakeSocialClient({ posts: [original] }, { offline: true });
    expect(await resharePost(client, ME, originalPost(), NOW)).toEqual({ ok: false, reason: 'failed' });
  });

  it('a request that throws is "failed" too', async () => {
    const throwing = {
      from: () => {
        throw new Error('boom');
      },
    } as unknown as Parameters<typeof resharePost>[0];
    expect(await resharePost(throwing, ME, originalPost(), NOW)).toEqual({ ok: false, reason: 'failed' });
  });

  it('has a sentence for every outcome', () => {
    expect(Object.keys(RESHARE_MESSAGES).sort()).toEqual(['already-reshared', 'done', 'failed']);
  });
});
