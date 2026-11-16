/**
 * Tests for the Marketplace reads (B40 — MKT-1, MKT-4), against the in-memory fake client:
 * the browse list is published, live programs only, newest first, with author names, and the
 * request pins the `visibility = published` and "not deleted" filters (without them the lifter's
 * own private and deleted programs would show — the server lets an author read their own); search
 * sends a websearch full-text query and narrows to whole-word matches; the limit grows for "Show
 * more"; a program page reads its row and its payload (or null when it can't be seen); offline
 * throws; and `programFacts` / `programFactsLine` describe length and days per week.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import {
  loadProgramPage,
  loadPublishedPrograms,
  MARKETPLACE_PAGE_SIZE,
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
    const page = await loadProgramPage(fake.client, 'p1');
    expect(page?.summary).toMatchObject({ id: 'p1', name: 'Starting Strength', authorId: 'alex', visibility: 'published' });
    expect(page?.payload?.weeks).toHaveLength(2);
    expect(fake.requests).toContainEqual([['rpc', 'program_payload', { p_program: 'p1' }]]);
  });

  it('a program the lifter can’t see (or a deleted one) is null; a lost payload is a null payload', async () => {
    const fake = seeded({ program_payload: () => null });
    expect(await loadProgramPage(fake.client, 'nope')).toBeNull();
    expect(await loadProgramPage(fake.client, 'deleted')).toBeNull();
    expect((await loadProgramPage(fake.client, 'p2'))?.payload).toBeNull();
  });

  it('offline: throws', async () => {
    const fake = seeded({ program_payload: () => payload });
    fake.setOffline(true);
    await expect(loadProgramPage(fake.client, 'p1')).rejects.toThrow();
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
