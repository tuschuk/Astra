/**
 * Tests for the profile reads and the own-profile save (B25), against the in-memory fake social
 * client. Pinned here:
 *   - counts come from the server's `follow_counts`, NOT from rows the viewer can see (the step
 *     DoD "counts equal the follows rows" — the fake's rpc counts every row, like the definer
 *     function, while the viewer could only see their own);
 *   - another lifter's history is walked page by page to the very first workout (YOU-2);
 *   - their PRs come back grouped per exercise exactly as stored (YOU-3);
 *   - each server refusal of a save lands under the right box.
 * Visibility itself (RLS) is proven live at Gate 2, not here.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import { groupPrs } from '@/workout/prList';

import {
  beforeStartedFilter,
  HISTORY_PAGE_SIZE,
  loadProfileHeader,
  loadProfilePrs,
  loadWorkoutDetail,
  loadWorkoutHistory,
  PROFILE_SAVE_FAILED,
  updateProfile,
  type HistoryCursor,
} from './profile';
import { PROFILE_FIELD_MESSAGES } from './profileLimits';

const ME = 'me';
const SAM = profile('sam', 'sam_lifts', 'Sam', { bio: 'Heavy singles.', avatar_url: 'sam/face.jpg' });

describe('loadProfileHeader', () => {
  it('shapes the five facts, with counts from the server function rather than visible rows', async () => {
    const fake = createFakeSocialClient({
      profiles: [profile(ME, 'me_lifts'), SAM],
      // Three follow Sam and Sam follows one — the viewer is part of only one of these rows.
      follows: [
        { follower_id: ME, followee_id: 'sam' },
        { follower_id: 'x', followee_id: 'sam' },
        { follower_id: 'y', followee_id: 'sam' },
        { follower_id: 'sam', followee_id: 'z' },
      ],
    });
    const header = await loadProfileHeader(fake.client, ME, 'sam');
    expect(header).toEqual({
      id: 'sam',
      username: 'sam_lifts',
      displayName: 'Sam',
      bio: 'Heavy singles.',
      avatarPath: 'sam/face.jpg',
      followers: 3,
      following: 1,
      viewerFollows: true,
    });
    expect(fake.requests).toContainEqual([['rpc', 'follow_counts', { profile_id: 'sam' }]]);
  });

  it('on my own profile asks nothing about following myself', async () => {
    const fake = createFakeSocialClient({ profiles: [profile(ME, null)] });
    const header = await loadProfileHeader(fake.client, ME, ME);
    expect(header).toMatchObject({ followers: 0, following: 0, viewerFollows: null, bio: null, avatarPath: null });
    expect(fake.requests.filter((r) => r[0][1] === 'follows')).toHaveLength(0);
  });

  it('is null for a profile that does not exist, and throws offline', async () => {
    const fake = createFakeSocialClient({ profiles: [profile(ME, null)] });
    expect(await loadProfileHeader(fake.client, ME, 'gone')).toBeNull();
    fake.setOffline(true);
    await expect(loadProfileHeader(fake.client, ME, ME)).rejects.toThrow();
  });
});

describe('updateProfile', () => {
  const values = { displayName: 'New', bio: 'Bio', username: 'new_name', avatarPath: `${ME}/a.jpg` };

  it('saves my row', async () => {
    const fake = createFakeSocialClient({ profiles: [profile(ME, 'old')] });
    expect(await updateProfile(fake.client, ME, values)).toEqual({ ok: true });
    expect(fake.tables.profiles[0]).toMatchObject({ username: 'new_name', display_name: 'New', bio: 'Bio', avatar_url: `${ME}/a.jpg` });
  });

  it('a username someone else holds (any case) lands under the username box', async () => {
    const fake = createFakeSocialClient({ profiles: [profile(ME, 'old'), profile('o', 'New_Name')] });
    expect(await updateProfile(fake.client, ME, values)).toEqual({
      ok: false,
      field: 'username',
      message: PROFILE_FIELD_MESSAGES.usernameTaken,
    });
    expect(fake.tables.profiles[0].username).toBe('old');
  });

  it('maps each CHECK to its box; an unexplained refusal or no signal is the calm sentence', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = createFakeSocialClient({ profiles: [profile(ME, 'old')] });
    expect(await updateProfile(fake.client, ME, { ...values, bio: 'b'.repeat(301) })).toMatchObject({ field: 'bio' });
    expect(await updateProfile(fake.client, ME, { ...values, displayName: 'd'.repeat(51) })).toMatchObject({
      field: 'displayName',
    });
    expect(await updateProfile(fake.client, ME, { ...values, username: 'no spaces' })).toMatchObject({ field: 'username' });
    // Someone else's folder: the own-folder CHECK — nothing the lifter typed, so the general line.
    expect(await updateProfile(fake.client, ME, { ...values, avatarPath: 'sam/face.jpg' })).toEqual({
      ok: false,
      field: null,
      message: PROFILE_SAVE_FAILED,
    });
    fake.setOffline(true);
    expect(await updateProfile(fake.client, ME, values)).toEqual({ ok: false, field: null, message: PROFILE_SAVE_FAILED });
    warn.mockRestore();
  });
});

/** A finished workout as the history read returns it. */
function workout(i: number, start: string, finished = true) {
  return {
    id: `w${String(i).padStart(2, '0')}`,
    user_id: 'sam',
    title: i === 0 ? null : `Session ${i}`,
    started_at: start,
    ended_at: finished ? start.replace('T09', 'T10') : null,
    workout_exercises: [
      { id: `e${i}b`, position: 1, exercise: null, sets: [{ id: `s${i}c` }] },
      { id: `e${i}a`, position: 0, exercise: { name: 'Squat' }, sets: [{ id: `s${i}a` }, { id: `s${i}b` }] },
    ],
  };
}

describe('loadWorkoutDetail (B37)', () => {
  const set = (id: string, position: number) => ({
    id,
    position,
    reps: 5,
    weight_kg: 100,
    rpe: null,
    is_warmup: false,
    duration_seconds: null,
    score: null,
    drop_set_position: null,
    notes: null,
  });
  const workout = {
    id: 'w1',
    user_id: 'member',
    title: 'Squats',
    notes: null,
    started_at: '2026-11-15T09:00:00.000Z',
    ended_at: '2026-11-15T10:00:00.000Z',
    workout_exercises: [
      { id: 'e2', position: 1, superset_group: null, notes: null, exercise: null, sets: [] },
      { id: 'e1', position: 0, superset_group: 1, notes: 'Belt', exercise: { name: 'Squat' }, sets: [set('s2', 1), set('s1', 0)] },
    ],
  };

  it('reads one workout, entries and sets sorted by position, names flattened', async () => {
    const fake = createFakeSocialClient({ workouts: [workout] });
    const detail = await loadWorkoutDetail(fake.client, 'w1');
    expect(detail).toMatchObject({ id: 'w1', userId: 'member', title: 'Squats' });
    expect(detail?.entries.map((e) => [e.id, e.exerciseName])).toEqual([
      ['e1', 'Squat'],
      ['e2', null],
    ]);
    expect(detail?.entries[0].sets.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('answers null for a workout the server withholds, and throws offline', async () => {
    const fake = createFakeSocialClient({ workouts: [workout] });
    expect(await loadWorkoutDetail(fake.client, 'nope')).toBeNull();
    fake.setOffline(true);
    await expect(loadWorkoutDetail(fake.client, 'w1')).rejects.toThrow();
  });
});

describe('loadWorkoutHistory', () => {
  it('walks the complete history, newest first, finished only, to the very first workout (YOU-2)', async () => {
    const rows = Array.from({ length: HISTORY_PAGE_SIZE * 2 + 3 }, (_, i) =>
      workout(i, `2026-10-${String((i % 28) + 1).padStart(2, '0')}T09:00:00.000Z`),
    );
    const fake = createFakeSocialClient({
      workouts: [...rows, workout(99, '2026-11-30T09:00:00.000Z', false), { ...workout(98, '2026-11-01T09:00:00.000Z'), user_id: 'x' }],
    });
    const walked: string[] = [];
    let after: HistoryCursor | null = null;
    let pages = 0;
    do {
      const page = await loadWorkoutHistory(fake.client, 'sam', after);
      walked.push(...page.workouts.map((w) => w.id));
      after = page.next;
      pages += 1;
    } while (after);
    expect(pages).toBe(3);
    expect(walked).toHaveLength(rows.length);
    expect(new Set(walked)).toEqual(new Set(rows.map((r) => r.id)));
    const sorted = [...rows].sort((a, b) => (a.started_at === b.started_at ? (a.id < b.id ? 1 : -1) : a.started_at < b.started_at ? 1 : -1));
    expect(walked).toEqual(sorted.map((r) => r.id));
  });

  it('shapes a row: exercises in workout order (a hidden custom one is null), and the set count', async () => {
    const fake = createFakeSocialClient({ workouts: [workout(0, '2026-11-01T09:00:00.000Z')] });
    const page = await loadWorkoutHistory(fake.client, 'sam', null);
    expect(page.workouts[0]).toEqual({
      id: 'w00',
      title: null,
      started_at: '2026-11-01T09:00:00.000Z',
      ended_at: '2026-11-01T10:00:00.000Z',
      exerciseNames: ['Squat', null],
      setCount: 3,
    });
    expect(page.next).toBeNull();
  });

  it('builds a quoted keyset filter', () => {
    expect(beforeStartedFilter({ started_at: '2026-11-01T09:00:00+00:00', id: 'w1' })).toBe(
      'started_at.lt."2026-11-01T09:00:00+00:00",and(started_at.eq."2026-11-01T09:00:00+00:00",id.lt.w1)',
    );
  });
});

describe('loadProfilePrs / groupPrs', () => {
  it('returns the stored rows grouped per exercise, names first alphabetically, books in order (YOU-3)', async () => {
    const fake = createFakeSocialClient({
      personal_records: [
        { id: 'r1', user_id: 'sam', exercise_id: 'sq', kind: 'repMax', reps: 5, value_kg: '150.000', exercise: { name: 'Squat' } },
        { id: 'r2', user_id: 'sam', exercise_id: 'sq', kind: 'true1rm', reps: null, value_kg: 180, exercise: { name: 'Squat' } },
        { id: 'r3', user_id: 'sam', exercise_id: 'bp', kind: 'e1rm', reps: null, value_kg: 133.333, exercise: { name: 'Bench Press' } },
        { id: 'r4', user_id: 'sam', exercise_id: 'cx', kind: 'true1rm', reps: null, value_kg: 50, exercise: null },
        { id: 'r5', user_id: 'other', exercise_id: 'sq', kind: 'true1rm', reps: null, value_kg: 300, exercise: { name: 'Squat' } },
      ],
    });
    expect(await loadProfilePrs(fake.client, 'sam')).toEqual([
      { exerciseId: 'bp', exerciseName: 'Bench Press', records: [{ id: 'r3', kind: 'e1rm', reps: null, value_kg: 133.333 }] },
      {
        exerciseId: 'sq',
        exerciseName: 'Squat',
        records: [
          { id: 'r2', kind: 'true1rm', reps: null, value_kg: 180 },
          { id: 'r1', kind: 'repMax', reps: 5, value_kg: 150 },
        ],
      },
      { exerciseId: 'cx', exerciseName: null, records: [{ id: 'r4', kind: 'true1rm', reps: null, value_kg: 50 }] },
    ]);
  });

  it('groups nothing into nothing', () => {
    expect(groupPrs([])).toEqual([]);
  });
});
