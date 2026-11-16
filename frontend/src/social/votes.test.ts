/**
 * Tests for voting (B23, SOC-4): the score arithmetic of a changed vote, what an arrow tap
 * means, and casting / clearing a vote against the in-memory fake — one vote per lifter per
 * post, and the upvote-only refusal turned into its sentence. (B41) The program arm: the same
 * one-row-per-lifter upsert on `program_votes`, both arrows, and every refusal as 'failed'.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawImagePost, rawPost } from '@/test-utils/feedFixtures';

import { castProgramVote, castVote, clearProgramVote, clearVote, nextVote, voteDelta } from './votes';

const author = profile('a', 'author');
const wod = rawPost({ id: 'wod', author, createdAt: '2026-11-15T08:00:00.000Z' });
// Physique Check, as seeded: the flair row's upvotes_only is true.
const physique = rawImagePost({ id: 'pc', author, createdAt: '2026-11-15T08:00:00.000Z', kind: 'progress-pic' });

/** The fake's score for a post: the sum of its votes, like the `post_scores` view. */
function score(tables: { votes: Record<string, unknown>[] }, postId: string): number {
  return tables.votes.filter((v) => v.post_id === postId).reduce((s, v) => s + Number(v.value), 0);
}

describe('voteDelta', () => {
  it('moves the score by the difference between the old and new vote', () => {
    expect(voteDelta(null, 1)).toBe(1);
    expect(voteDelta(null, -1)).toBe(-1);
    expect(voteDelta(1, -1)).toBe(-2);
    expect(voteDelta(-1, 1)).toBe(2);
    expect(voteDelta(1, null)).toBe(-1);
    expect(voteDelta(-1, null)).toBe(1);
    expect(voteDelta(1, 1)).toBe(0);
    expect(voteDelta(null, null)).toBe(0);
  });
});

describe('nextVote', () => {
  it('tapping the lit arrow takes the vote back; the other arrow switches; none sets', () => {
    expect(nextVote(null, 1)).toBe(1);
    expect(nextVote(1, 1)).toBeNull();
    expect(nextVote(1, -1)).toBe(-1);
    expect(nextVote(-1, -1)).toBeNull();
  });
});

describe('castVote / clearVote', () => {
  it('upserts on (post, lifter): changing a vote rewrites the one row, never adds a second', async () => {
    const fake = createFakeSocialClient({ posts: [wod] });
    expect(await castVote(fake.client, 'b', 'wod', 1)).toEqual({ ok: true });
    expect(await castVote(fake.client, 'c', 'wod', 1)).toEqual({ ok: true });
    expect(await castVote(fake.client, 'd', 'wod', -1)).toEqual({ ok: true });
    expect(score(fake.tables, 'wod')).toBe(1);
    // d changes their mind: down → up moves the tally by 2.
    await castVote(fake.client, 'd', 'wod', 1);
    expect(score(fake.tables, 'wod')).toBe(3);
    // A retried tap lands on the same row.
    await castVote(fake.client, 'd', 'wod', 1);
    expect(fake.tables.votes.filter((v) => v.user_id === 'd')).toHaveLength(1);
    expect(fake.requests[0]).toEqual([
      ['from', 'votes'],
      ['upsert', { post_id: 'wod', user_id: 'b', value: 1 }, { onConflict: 'post_id,user_id' }],
    ]);
  });

  it('clearing deletes only my vote', async () => {
    const fake = createFakeSocialClient({
      posts: [wod],
      votes: [
        { post_id: 'wod', user_id: 'me', value: 1 },
        { post_id: 'wod', user_id: 'other', value: 1 },
      ],
    });
    expect(await clearVote(fake.client, 'me', 'wod')).toEqual({ ok: true });
    expect(fake.tables.votes).toEqual([{ post_id: 'wod', user_id: 'other', value: 1 }]);
  });

  it('a downvote on an upvote-only post is refused (the trigger’s P0001) and named as such; an upvote goes through', async () => {
    const fake = createFakeSocialClient({ posts: [physique] });
    expect(await castVote(fake.client, 'b', 'pc', -1)).toEqual({ ok: false, reason: 'upvotes-only' });
    expect(fake.tables.votes).toHaveLength(0);
    expect(await castVote(fake.client, 'b', 'pc', 1)).toEqual({ ok: true });
    // Switching that upvote to a downvote is refused too (the update arm of the upsert).
    expect(await castVote(fake.client, 'b', 'pc', -1)).toEqual({ ok: false, reason: 'upvotes-only' });
    expect(fake.tables.votes).toEqual([{ post_id: 'pc', user_id: 'b', value: 1 }]);
  });

  it('a failed request (no signal) is a plain failure, never a throw', async () => {
    const fake = createFakeSocialClient({ posts: [wod] }, { offline: true });
    expect(await castVote(fake.client, 'b', 'wod', 1)).toEqual({ ok: false, reason: 'failed' });
    expect(await clearVote(fake.client, 'b', 'wod')).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('castProgramVote / clearProgramVote (B41 — MKT-3)', () => {
  const programs = [{ id: 'prog', user_id: 'a', name: 'PHUL', visibility: 'published', deleted_at: null, created_at: '2026-11-15T08:00:00.000Z' }];

  it('upserts on (program, lifter): a changed mind rewrites the one row, never adds a second', async () => {
    const fake = createFakeSocialClient({ programs });
    expect(await castProgramVote(fake.client, 'b', 'prog', 1)).toEqual({ ok: true });
    expect(fake.requests[0]).toContainEqual(['upsert', { program_id: 'prog', user_id: 'b', value: 1 }, { onConflict: 'program_id,user_id' }]);
    expect(await castProgramVote(fake.client, 'b', 'prog', -1)).toEqual({ ok: true });
    expect(fake.tables.program_votes).toEqual([{ program_id: 'prog', user_id: 'b', value: -1 }]);
    // Both arrows: a program takes downvotes (no flair, no upvote-only rule).
    expect(await castProgramVote(fake.client, 'c', 'prog', -1)).toEqual({ ok: true });
    expect(fake.tables.program_votes).toHaveLength(2);
    // Post votes are untouched.
    expect(fake.tables.votes).toEqual([]);
  });

  it('clearing deletes only my vote on that program', async () => {
    const fake = createFakeSocialClient({
      programs,
      program_votes: [
        { program_id: 'prog', user_id: 'b', value: 1 },
        { program_id: 'prog', user_id: 'c', value: 1 },
      ],
    });
    expect(await clearProgramVote(fake.client, 'b', 'prog')).toEqual({ ok: true });
    expect(fake.tables.program_votes).toEqual([{ program_id: 'prog', user_id: 'c', value: 1 }]);
  });

  it('every refusal is the failed sentence — even a P0001, which means nothing special on programs', async () => {
    const refused = createFakeSocialClient({ programs }, { refuse: { program_votes: { code: 'P0001', message: 'x' } } });
    expect(await castProgramVote(refused.client, 'b', 'prog', -1)).toEqual({ ok: false, reason: 'failed' });
    const rls = createFakeSocialClient({ programs }, { refuse: { program_votes: { code: '42501', message: 'row-level security' } } });
    expect(await castProgramVote(rls.client, 'b', 'prog', 1)).toEqual({ ok: false, reason: 'failed' });
    const offline = createFakeSocialClient({ programs }, { offline: true });
    expect(await castProgramVote(offline.client, 'b', 'prog', 1)).toEqual({ ok: false, reason: 'failed' });
    expect(await clearProgramVote(offline.client, 'b', 'prog')).toEqual({ ok: false, reason: 'failed' });
  });
});
