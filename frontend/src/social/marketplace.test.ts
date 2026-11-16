/**
 * Tests for the Marketplace reads (B40 — MKT-1, MKT-4), against the in-memory fake client:
 * the browse list is published, live programs only, newest first, with author names, and the
 * request pins the `visibility = published` and "not deleted" filters (without them the lifter's
 * own private and deleted programs would show — the server lets an author read their own); search
 * sends a websearch full-text query and narrows to whole-word matches; the limit grows for "Show
 * more"; a program page reads its row and its payload (or null when it can't be seen); offline
 * throws; and `programFacts` / `programFactsLine` describe length and days per week.
 * (B41) The page also carries the score, comment count and the viewer's own vote (the vote read
 * filtered to the viewer); the Featured read goes through `program_scores` with the shelf
 * filters, ranks each rolling window by the votes cast inside it (ties newest first), and moves
 * when a vote flips — against the fake's labelled mirror of the view's window sums.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import {
  FEATURED_LIMIT,
  FEATURED_WINDOW_COLUMNS,
  loadFeaturedPrograms,
  loadProgramPage,
  loadPublishedPrograms,
  MARKETPLACE_PAGE_SIZE,
  type FeaturedWindow,
  programFacts,
  programFactsLine,
} from './marketplace';
import type { TeamProgramPayload } from './teamCoaching';

const ME = 'me';
const alex = profile('alex', 'alex_lifts', 'Alex');

const program = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: 'alex',
  name,
  visibility: 'published',
  deleted_at: null,
  created_at: '2026-11-15T10:00:00.000Z',
  ...extra,
});

function seeded(rpc: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
  return createFakeSocialClient(
    {
      profiles: [alex, profile(ME, 'me_lifts', 'Me')],
      programs: [
        program('p1', 'Starting Strength', { created_at: '2026-11-15T09:00:00.000Z' }),
        program('p2', 'PHUL Power Hypertrophy', { created_at: '2026-11-15T11:00:00.000Z' }),
        program('p3', 'Strength Block', { created_at: '2026-11-15T10:00:00.000Z' }),
        // The server would show my own private and deleted programs to me — the filters must drop them.
        program('mine-private', 'My Strength Secret', { user_id: ME, visibility: 'private' }),
        program('deleted', 'Old Strength', { deleted_at: '2026-11-15T12:00:00.000Z' }),
      ],
    },
    { rpc },
  );
}

const payload: TeamProgramPayload = {
  name: 'Starting Strength',
  weeks: [
    { position: 0, workouts: [{ name: 'A', position: 0, exercises: [] }, { name: 'B', position: 1, exercises: [] }] },
    { position: 1, workouts: [{ name: 'A', position: 0, exercises: [] }, { name: 'B', position: 1, exercises: [] }, { name: 'C', position: 2, exercises: [] }] },
  ],
};

describe('loadPublishedPrograms', () => {
  it('browse: published, live programs newest first, with the author — never my private or deleted ones', async () => {
    const fake = seeded();
    const list = await loadPublishedPrograms(fake.client);
    expect(list.map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
    expect(list[0]).toMatchObject({ name: 'PHUL Power Hypertrophy', authorId: 'alex', author: { username: 'alex_lifts', displayName: 'Alex' } });
    const calls = fake.requests[0];
    expect(calls).toContainEqual(['eq', 'visibility', 'published']);
    expect(calls).toContainEqual(['is', 'deleted_at', null]);
    expect(calls).toContainEqual(['limit', MARKETPLACE_PAGE_SIZE]);
    expect(calls.some(([m]) => m === 'textSearch')).toBe(false);
  });

  it('search: sends a websearch full-text query and finds programs by a whole word of the name', async () => {
    const fake = seeded();
    const list = await loadPublishedPrograms(fake.client, { query: '  Strength ' });
    expect(list.map((p) => p.id)).toEqual(['p3', 'p1']);
    expect(fake.requests[0]).toContainEqual(['textSearch', 'search', 'Strength', { type: 'websearch', config: 'simple' }]);
    expect((await loadPublishedPrograms(fake.client, { query: 'phul' })).map((p) => p.id)).toEqual(['p2']);
    expect(await loadPublishedPrograms(fake.client, { query: 'Strong' })).toEqual([]);
  });

  it('show more: the limit is the caller’s', async () => {
    const fake = seeded();
    expect(await loadPublishedPrograms(fake.client, { limit: 2 })).toHaveLength(2);
    expect(fake.requests[0]).toContainEqual(['limit', 2]);
  });

  it('offline: throws', async () => {
    const fake = seeded();
    fake.setOffline(true);
    await expect(loadPublishedPrograms(fake.client)).rejects.toThrow(/Marketplace/);
  });
});

describe('loadProgramPage', () => {
  it('reads the row and the whole program through program_payload', async () => {
    const fake = seeded({ program_payload: (p) => (p.p_program === 'p1' ? payload : null) });
    const page = await loadProgramPage(fake.client, 'p1', ME);
    expect(page?.summary).toMatchObject({ id: 'p1', name: 'Starting Strength', authorId: 'alex', visibility: 'published' });
    expect(page?.payload?.weeks).toHaveLength(2);
    expect(fake.requests).toContainEqual([['rpc', 'program_payload', { p_program: 'p1' }]]);
  });

  it('a program the lifter can’t see (or a deleted one) is null; a lost payload is a null payload', async () => {
    const fake = seeded({ program_payload: () => null });
    expect(await loadProgramPage(fake.client, 'nope', ME)).toBeNull();
    expect(await loadProgramPage(fake.client, 'deleted', ME)).toBeNull();
    expect((await loadProgramPage(fake.client, 'p2', ME))?.payload).toBeNull();
  });

  it('offline: throws', async () => {
    const fake = seeded({ program_payload: () => payload });
    fake.setOffline(true);
    await expect(loadProgramPage(fake.client, 'p1', ME)).rejects.toThrow();
  });

  it('(B41) carries the score, the comment count and MY vote — filtered to me, since every viewer reads all votes', async () => {
    const fake = seeded({ program_payload: () => payload });
    fake.tables.program_votes.push(
      { program_id: 'p1', user_id: 'alex', value: 1 },
      { program_id: 'p1', user_id: 'x', value: 1 },
      { program_id: 'p1', user_id: ME, value: -1 },
      { program_id: 'p2', user_id: ME, value: 1 },
    );
    fake.tables.program_comments.push({ id: 'c1', program_id: 'p1', user_id: 'alex', body: 'hi', created_at: '2026-11-15T10:00:00.000Z' });
    const page = await loadProgramPage(fake.client, 'p1', ME);
    expect(page).toMatchObject({ score: 1, commentCount: 1, myVote: -1 });
    const voteRead = fake.requests.find((calls) => calls[0][1] === 'program_votes');
    expect(voteRead).toContainEqual(['eq', 'user_id', ME]);
    expect(voteRead).toContainEqual(['eq', 'program_id', 'p1']);
    expect(voteRead).toContainEqual(['maybeSingle']);
  });

  it('(B41) no votes reads as zeros and no vote; signed out sends no vote read at all', async () => {
    const fake = seeded({ program_payload: () => payload });
    expect(await loadProgramPage(fake.client, 'p3', ME)).toMatchObject({ score: 0, commentCount: 0, myVote: null });
    const before = fake.requests.length;
    expect(await loadProgramPage(fake.client, 'p3', null)).toMatchObject({ myVote: null });
    expect(fake.requests.slice(before).some((calls) => calls[0][1] === 'program_votes')).toBe(false);
  });
});

/** A vote cast `daysAgo` days back (the windows are rolling, counted from now). */
function voteAt(programId: string, userId: string, value: 1 | -1, daysAgo: number) {
  return { program_id: programId, user_id: userId, value, created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString() };
}

describe('loadFeaturedPrograms (B41 — MKT-2)', () => {
  it('maps each window to its score column', () => {
    expect(FEATURED_WINDOW_COLUMNS).toEqual({ week: 'score_week', month: 'score_month', year: 'score_year', all: 'score' });
  });

  it('reads through program_scores with the shelf filters, the window’s column first, ties newest', async () => {
    const fake = seeded();
    await loadFeaturedPrograms(fake.client, 'month');
    const calls = fake.requests[0];
    expect(calls[0]).toEqual(['from', 'program_scores']);
    expect(calls).toContainEqual(['eq', 'visibility', 'published']);
    expect(calls).toContainEqual(['is', 'deleted_at', null]);
    const orders = calls.filter(([m]) => m === 'order');
    expect(orders).toEqual([
      ['order', 'score_month', { ascending: false }],
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
    ]);
    expect(calls).toContainEqual(['limit', FEATURED_LIMIT]);
  });

  it('each window ranks by the votes cast inside it — and never shows my private or deleted programs', async () => {
    const fake = seeded();
    fake.tables.program_votes.push(
      // p1: two votes this week.
      voteAt('p1', 'a', 1, 1),
      voteAt('p1', 'b', 1, 2),
      // p3: one this week, two 8 days back (month, not week), three 400 days back (all time only).
      voteAt('p3', 'a', 1, 0),
      voteAt('p3', 'b', 1, 8),
      voteAt('p3', 'c', 1, 8),
      voteAt('p3', 'd', 1, 400),
      voteAt('p3', 'e', 1, 400),
      voteAt('p3', 'f', 1, 400),
      // The private and deleted ones are hugely popular — and still never featured.
      voteAt('mine-private', 'a', 1, 0),
      voteAt('mine-private', 'b', 1, 0),
      voteAt('mine-private', 'c', 1, 0),
      voteAt('deleted', 'a', 1, 0),
      voteAt('deleted', 'b', 1, 0),
      voteAt('deleted', 'c', 1, 0),
    );
    const ids = async (w: FeaturedWindow) => (await loadFeaturedPrograms(fake.client, w)).map((p) => `${p.id}:${p.score}`);
    // p2 has no votes: 0, and it is the newest, so it leads the zeros.
    expect(await ids('week')).toEqual(['p1:2', 'p3:1', 'p2:0']);
    expect(await ids('month')).toEqual(['p3:3', 'p1:2', 'p2:0']);
    expect(await ids('year')).toEqual(['p3:3', 'p1:2', 'p2:0']);
    expect(await ids('all')).toEqual(['p3:6', 'p1:2', 'p2:0']);
    const [first] = await loadFeaturedPrograms(fake.client, 'week');
    expect(first).toMatchObject({ name: 'Starting Strength', author: { displayName: 'Alex' } });
  });

  it('updates as votes change: a flipped vote moves the ranking', async () => {
    const fake = seeded();
    fake.tables.program_votes.push(voteAt('p1', 'a', 1, 1), voteAt('p1', 'b', 1, 1), voteAt('p3', 'c', 1, 1));
    expect((await loadFeaturedPrograms(fake.client, 'week')).map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    // b changes their mind on p1 (up → down): p1 drops by 2, below p3.
    Object.assign(fake.tables.program_votes[1], { value: -1 });
    expect((await loadFeaturedPrograms(fake.client, 'week')).map((p) => `${p.id}:${p.score}`)).toEqual(['p3:1', 'p2:0', 'p1:0']);
  });

  it('the limit is the caller’s; offline throws', async () => {
    const fake = seeded();
    expect(await loadFeaturedPrograms(fake.client, 'all', 2)).toHaveLength(2);
    fake.setOffline(true);
    await expect(loadFeaturedPrograms(fake.client, 'week')).rejects.toThrow(/featured/);
  });
});

describe('programFacts', () => {
  it('uniform weeks give one number; varied weeks a range; no weeks zero', () => {
    const uniform = { ...payload, weeks: [payload.weeks[1], payload.weeks[1]] };
    expect(programFacts(uniform)).toEqual({ weekCount: 2, daysPerWeek: '3', hasWorkouts: true });
    expect(programFacts(payload)).toEqual({ weekCount: 2, daysPerWeek: '2–3', hasWorkouts: true });
    expect(programFacts({ name: 'x', weeks: [] })).toEqual({ weekCount: 0, daysPerWeek: '0', hasWorkouts: false });
    expect(programFacts({ name: 'x', weeks: [{ position: 0, workouts: [] }] }).hasWorkouts).toBe(false);
  });

  it('reads as one line, singular where it should be', () => {
    expect(programFactsLine(programFacts(payload))).toBe('2 weeks · 2–3 days/week');
    expect(programFactsLine({ weekCount: 1, daysPerWeek: '1', hasWorkouts: true })).toBe('1 week · 1 day/week');
  });
});
