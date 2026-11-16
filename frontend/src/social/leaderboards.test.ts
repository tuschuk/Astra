/**
 * Tests for the leaderboard module (B52). The board read asks the server for one gym's one lift
 * in the ranking order (heaviest first, earlier verification first on a tie, then id), and keeps
 * that order; `splitBoard` puts the rows into exactly two divisions numbered from 1. Also the
 * schema rules the fake imitates: one row per member per lift per gym (a second insert is
 * refused) and an upsert on that key replacing the old best (GYM-6's mechanism). The client is
 * the in-memory fake social client with fixture rows; who may write the board was probed live.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import { BOARD_LIMIT, DIVISION_LABELS, LIFT_LABELS, LIFTS, loadBoard, splitBoard, type BoardEntry } from './leaderboards';

/** A fixture board row. */
const entry = (id: string, userId: string, lift: string, division: string, weightKg: number | string, verifiedAt: string, gymId = 'g1') => ({
  id,
  gym_id: gymId,
  user_id: userId,
  lift,
  division,
  weight_kg: weightKg,
  verified_at: verifiedAt,
});

const PROFILES = [profile('ann', 'ann_lifts', 'Ann'), profile('bo', 'bo', null), profile('cy', null, null), profile('di', 'di', 'Di')];

/** A board entry as the app holds it, for `splitBoard`. */
const boardEntry = (id: string, division: 'male' | 'female', weightKg: number): BoardEntry => ({
  id,
  userId: id,
  division,
  weightKg,
  verifiedAt: '2026-11-10T00:00:00.000Z',
  username: null,
  displayName: null,
});

describe('loadBoard', () => {
  it('asks for one gym and one lift, ranked heaviest first with ties to the earlier verification', async () => {
    const fake = createFakeSocialClient({
      profiles: PROFILES,
      leaderboard_entries: [
        entry('e1', 'ann', 'squat', 'female', 140, '2026-11-08T00:00:00.000Z'),
        entry('e2', 'bo', 'squat', 'male', 200, '2026-11-10T00:00:00.000Z'),
        entry('e3', 'cy', 'squat', 'male', 200, '2026-11-09T00:00:00.000Z'),
        entry('e4', 'di', 'squat', 'male', 180.5, '2026-11-01T00:00:00.000Z'),
        entry('e5', 'bo', 'bench', 'male', 300, '2026-11-01T00:00:00.000Z'),
        entry('e6', 'ann', 'squat', 'female', 400, '2026-11-01T00:00:00.000Z', 'g2'),
      ],
    });
    const board = await loadBoard(fake.client, 'g1', 'squat');
    // Tie at 200: cy verified first, so cy ranks above bo. Other lifts and gyms never mix in.
    expect(board.map((e) => e.id)).toEqual(['e3', 'e2', 'e4', 'e1']);
    expect(board[2].weightKg).toBe(180.5);
    expect(board[0]).toEqual({
      id: 'e3',
      userId: 'cy',
      division: 'male',
      weightKg: 200,
      verifiedAt: '2026-11-09T00:00:00.000Z',
      username: null,
      displayName: null,
    });
    expect(board[3]).toMatchObject({ username: 'ann_lifts', displayName: 'Ann' });
    const request = fake.requests[0];
    expect(request).toContainEqual(['eq', 'gym_id', 'g1']);
    expect(request).toContainEqual(['eq', 'lift', 'squat']);
    // The ranking rule is the order clause, exactly these three keys in this order.
    expect(request.filter(([m]) => m === 'order')).toEqual([
      ['order', 'weight_kg', { ascending: false }],
      ['order', 'verified_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
    ]);
    expect(request).toContainEqual(['limit', BOARD_LIMIT]);
  });

  it('a weight sent as text (Postgres numeric) is held as a number', async () => {
    const fake = createFakeSocialClient({
      leaderboard_entries: [entry('e1', 'di', 'deadlift', 'male', '180.500', '2026-11-01T00:00:00.000Z')],
    });
    const [only] = await loadBoard(fake.client, 'g1', 'deadlift');
    expect(only.weightKg).toBe(180.5);
  });

  it('an empty board is an empty list', async () => {
    const fake = createFakeSocialClient();
    expect(await loadBoard(fake.client, 'g1', 'deadlift')).toEqual([]);
  });

  it('throws without a connection', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(loadBoard(fake.client, 'g1', 'bench')).rejects.toThrow();
  });
});

describe('the board’s one-row-per-member key (GYM-3, GYM-6)', () => {
  it('a second row for the same gym, member and lift is refused; an upsert on the key replaces the best', async () => {
    const fake = createFakeSocialClient({
      leaderboard_entries: [entry('e1', 'bo', 'squat', 'male', 200, '2026-11-01T00:00:00.000Z')],
    });
    const dup = await fake.client.from('leaderboard_entries').insert(entry('e2', 'bo', 'squat', 'male', 210, '2026-11-02T00:00:00.000Z'));
    expect(dup.error?.code).toBe('23505');
    // The same member on another lift, or at another gym, is a different row.
    const otherLift = await fake.client.from('leaderboard_entries').insert(entry('e3', 'bo', 'bench', 'male', 150, '2026-11-02T00:00:00.000Z'));
    expect(otherLift.error).toBeNull();

    await fake.client
      .from('leaderboard_entries')
      // A full row, as the server needs (division is not null — checked before the conflict).
      .upsert({ gym_id: 'g1', user_id: 'bo', lift: 'squat', division: 'male', weight_kg: 220, verified_at: '2026-11-12T00:00:00.000Z' }, { onConflict: 'gym_id,user_id,lift' });
    const board = await loadBoard(fake.client, 'g1', 'squat');
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ userId: 'bo', weightKg: 220, verifiedAt: '2026-11-12T00:00:00.000Z' });
  });
});

describe('splitBoard', () => {
  it('always returns exactly two divisions, each ranked from 1 in the given order', () => {
    const board = splitBoard([boardEntry('a', 'male', 250), boardEntry('b', 'female', 150), boardEntry('c', 'male', 250), boardEntry('d', 'male', 200)]);
    expect(Object.keys(board)).toEqual(['male', 'female']);
    // Positional ranks: a tie is 1 and 2, in the server's order — never re-sorted here.
    expect(board.male.map((e) => [e.id, e.rank])).toEqual([
      ['a', 1],
      ['c', 2],
      ['d', 3],
    ]);
    expect(board.female.map((e) => [e.id, e.rank])).toEqual([['b', 1]]);
  });

  it('an empty board still has both divisions; a row with an unknown division is left out', () => {
    expect(splitBoard([])).toEqual({ male: [], female: [] });
    const odd = { ...boardEntry('x', 'male', 100), division: 'other' as unknown as 'male' };
    expect(splitBoard([odd])).toEqual({ male: [], female: [] });
  });

  it('keeps the server’s order even when it is not heaviest-first (the server owns the rule)', () => {
    const board = splitBoard([boardEntry('light', 'female', 100), boardEntry('heavy', 'female', 200)]);
    expect(board.female.map((e) => e.id)).toEqual(['light', 'heavy']);
  });
});

describe('vocabularies', () => {
  it('three lifts and two divisions, each with a label', () => {
    expect(LIFTS).toEqual(['squat', 'bench', 'deadlift']);
    expect(LIFTS.map((l) => LIFT_LABELS[l])).toEqual(['Squat', 'Bench press', 'Deadlift']);
    expect(DIVISION_LABELS).toEqual({ male: 'Men', female: 'Women' });
  });
});
