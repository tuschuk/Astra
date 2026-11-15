/**
 * Tests for finding and following lifters (B20, SOC-7's app half): the search leaves out me and
 * people I blocked, marks who I already follow, and survives any typed garbage (G9); follow and
 * unfollow write the one-way follow row, and a block's refusal becomes a calm sentence.
 * Runs against the in-memory fake social client.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient, parseOrFilter } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import {
  follow,
  FOLLOW_FAILED,
  FOLLOW_REFUSED,
  sanitizeSearchTerm,
  searchFilter,
  searchLifters,
  SEARCH_LIMIT,
  unfollow,
} from './follows';

const ME = 'me';

function seeded() {
  return createFakeSocialClient({
    profiles: [
      profile(ME, 'sam_me', 'Sam'),
      profile('a', 'samantha', 'Samantha Squats'),
      profile('b', 'big_sam', null),
      profile('c', 'deadlift_dan', 'Dan'),
      profile('blocked', 'sammy_blocked', null),
      profile('pct', 'pct_guy', '50% Sam'),
    ],
    follows: [{ follower_id: ME, followee_id: 'a' }],
    blocks: [{ blocker_id: ME, blocked_id: 'blocked' }],
  });
}

describe('sanitizeSearchTerm', () => {
  it('removes filter syntax and escapes the like wildcards', () => {
    expect(sanitizeSearchTerm('  50%,()"\\*_x  ')).toBe('50\\\\%\\\\_x');
    expect(sanitizeSearchTerm('(),')).toBe('');
  });

  it('builds a filter the server can parse for any input', () => {
    for (const input of ['50%,()', 'a.b:c', 'o"neil', 'and(x)', 'é ü']) {
      expect(() => parseOrFilter(searchFilter(sanitizeSearchTerm(input)))).not.toThrow();
    }
  });
});

describe('searchLifters', () => {
  it('finds by username or display name, case-insensitive, without me or people I blocked, marking who I follow', async () => {
    const { client } = seeded();
    const results = await searchLifters(client, ME, 'SAM');
    expect(results.map((r) => r.id).sort()).toEqual(['a', 'b', 'pct']);
    expect(results.find((r) => r.id === 'a')).toEqual({
      id: 'a',
      username: 'samantha',
      displayName: 'Samantha Squats',
      following: true,
    });
    expect(results.find((r) => r.id === 'b')?.following).toBe(false);
  });

  it('matches `_` and `%` literally, not as wildcards', async () => {
    const { client } = seeded();
    expect((await searchLifters(client, ME, 'g_s')).map((r) => r.id)).toEqual(['b']);
    expect((await searchLifters(client, ME, 'bigXsam')).map((r) => r.id)).toEqual([]);
    expect((await searchLifters(client, ME, '50%')).map((r) => r.id)).toEqual(['pct']);
  });

  it('a garbage search returns few results, never an error (G9)', async () => {
    const { client } = seeded();
    await expect(searchLifters(client, ME, '50%,()')).resolves.toEqual([
      expect.objectContaining({ id: 'pct' }),
    ]);
    await expect(searchLifters(client, ME, '(),"')).resolves.toEqual([]);
  });

  it('people I blocked never use up result places (they are left out by the query, not after it)', async () => {
    const blockedMatches = Array.from({ length: SEARCH_LIMIT }, (_, i) => profile(`x${i}`, `aaa_sam_${i}`, null));
    const { client } = createFakeSocialClient({
      profiles: [...blockedMatches, profile('z', 'zz_sam', null)],
      blocks: blockedMatches.map((p) => ({ blocker_id: ME, blocked_id: p.id })),
    });
    expect((await searchLifters(client, ME, 'sam')).map((r) => r.id)).toEqual(['z']);
  });

  it('does not search under two characters, and caps the results', async () => {
    const { client, requests } = seeded();
    expect(await searchLifters(client, ME, ' s ')).toEqual([]);
    expect(requests).toHaveLength(0);
    await searchLifters(client, ME, 'sa');
    expect(requests[1]).toContainEqual(['limit', SEARCH_LIMIT]);
  });

  it('throws when offline', async () => {
    const { client, setOffline } = seeded();
    setOffline(true);
    await expect(searchLifters(client, ME, 'sam')).rejects.toThrow('Search failed');
  });
});

describe('follow / unfollow', () => {
  it('follow writes one one-way row; unfollow removes only mine', async () => {
    const { client, tables } = seeded();
    tables.follows.push({ follower_id: 'c', followee_id: ME });
    expect(await follow(client, ME, 'c')).toEqual({ ok: true });
    expect(tables.follows).toContainEqual({ follower_id: ME, followee_id: 'c' });
    // One-way: c already followed me; my follow adds a separate row, no mutual state.
    expect(tables.follows.filter((f) => f.follower_id === 'c')).toHaveLength(1);
    expect(await unfollow(client, ME, 'c')).toEqual({ ok: true });
    expect(tables.follows).not.toContainEqual({ follower_id: ME, followee_id: 'c' });
    expect(tables.follows).toContainEqual({ follower_id: 'c', followee_id: ME });
  });

  it('following twice is harmless', async () => {
    const { client, tables } = seeded();
    expect(await follow(client, ME, 'a')).toEqual({ ok: true });
    expect(tables.follows.filter((f) => f.followee_id === 'a')).toHaveLength(1);
  });

  it('a block (either direction) is refused with a calm message', async () => {
    const { client, tables } = seeded();
    expect(await follow(client, ME, 'blocked')).toEqual({ ok: false, message: FOLLOW_REFUSED });
    tables.blocks.push({ blocker_id: 'c', blocked_id: ME });
    expect(await follow(client, ME, 'c')).toEqual({ ok: false, message: FOLLOW_REFUSED });
  });

  it('a dropped connection says so', async () => {
    const { client, setOffline } = seeded();
    setOffline(true);
    expect(await follow(client, ME, 'c')).toEqual({ ok: false, message: FOLLOW_FAILED });
    expect(await unfollow(client, ME, 'a')).toEqual({ ok: false, message: FOLLOW_FAILED });
  });
});
