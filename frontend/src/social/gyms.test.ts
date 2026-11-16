/**
 * Tests for the Gyms module (B50): the directory read (server order kept, distances as numbers),
 * a lifter's gym, one gym, the roster, join / switch / leave (one membership per lifter — joining
 * a second gym replaces the first, which is the step's definition of done), and the distance
 * formatter. The client is the in-memory fake social client, which imitates the membership
 * table's primary key and the join-time trigger; who may write what was probed live at B50.
 */
import { describe, expect, it } from '@jest/globals';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import {
  formatDistance,
  GYM_FAILED,
  gymOf,
  joinGym,
  leaveGym,
  loadGym,
  loadGymMembers,
  METRES_PER_MILE,
  nearbyGyms,
} from './gyms';

const gym = (id: string, name: string) => ({ id, name, address: `${name} street` });
const GYMS = [gym('g1', 'First'), gym('g2', 'Second')];

describe('nearbyGyms', () => {
  it('asks gyms_near with the given point and keeps the server’s nearest-first order', async () => {
    let asked: Record<string, unknown> | null = null;
    const fake = createFakeSocialClient(
      {},
      {
        rpc: {
          gyms_near: (params) => {
            asked = params;
            return [
              { id: 'g2', name: 'Second', address: 'b', distance_m: 1200.5 },
              { id: 'g1', name: 'First', address: 'a', distance_m: '40000' },
            ];
          },
        },
      },
    );
    const rows = await nearbyGyms(fake.client, 39.7, -104.9);
    expect(asked).toEqual({ lat: 39.7, lng: -104.9 });
    expect(rows).toEqual([
      { id: 'g2', name: 'Second', address: 'b', distanceM: 1200.5 },
      { id: 'g1', name: 'First', address: 'a', distanceM: 40000 },
    ]);
  });

  it('throws when the server can’t be reached', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(nearbyGyms(fake.client, 0, 0)).rejects.toThrow(/gym directory/);
  });
});

describe('join, switch and leave (GYM-2)', () => {
  it('joining a second gym switches the active one: still one row, the new gym, a fresh join time', async () => {
    const fake = createFakeSocialClient({ gyms: [...GYMS] });
    expect(await gymOf(fake.client, 'me')).toBeNull();

    expect(await joinGym(fake.client, 'me', 'g1')).toEqual({ ok: true });
    expect(await gymOf(fake.client, 'me')).toEqual(GYMS[0]);
    const firstJoin = fake.tables.gym_members[0].joined_at;

    expect(await joinGym(fake.client, 'me', 'g2')).toEqual({ ok: true });
    expect(fake.tables.gym_members).toHaveLength(1);
    expect(await gymOf(fake.client, 'me')).toEqual(GYMS[1]);
    expect(String(fake.tables.gym_members[0].joined_at) > String(firstJoin)).toBe(true);
  });

  it('sends only user_id and gym_id, upserting on user_id (the server stamps the time)', async () => {
    const fake = createFakeSocialClient({ gyms: [...GYMS] });
    await joinGym(fake.client, 'me', 'g1');
    const upsert = fake.requests.flat().find((c) => c[0] === 'upsert');
    expect(upsert).toEqual(['upsert', { user_id: 'me', gym_id: 'g1' }, { onConflict: 'user_id' }]);
  });

  it('re-joining the gym you’re in keeps the join time', async () => {
    const fake = createFakeSocialClient({ gyms: [...GYMS] });
    await joinGym(fake.client, 'me', 'g1');
    const first = fake.tables.gym_members[0].joined_at;
    await joinGym(fake.client, 'me', 'g1');
    expect(fake.tables.gym_members[0].joined_at).toBe(first);
  });

  it('leave removes the one row; leaving with no gym is still fine', async () => {
    const fake = createFakeSocialClient({ gyms: [...GYMS], gym_members: [{ user_id: 'me', gym_id: 'g1', joined_at: 'x' }] });
    expect(await leaveGym(fake.client, 'me')).toEqual({ ok: true });
    expect(fake.tables.gym_members).toEqual([]);
    expect(await leaveGym(fake.client, 'me')).toEqual({ ok: true });
  });

  it('a failed request comes back as the connection sentence, never a throw', async () => {
    const fake = createFakeSocialClient({ gyms: [...GYMS] }, { offline: true });
    expect(await joinGym(fake.client, 'me', 'g1')).toEqual({ ok: false, message: GYM_FAILED });
    expect(await leaveGym(fake.client, 'me')).toEqual({ ok: false, message: GYM_FAILED });
  });
});

describe('reads', () => {
  it('gymOf works for anyone’s id (memberships are public); loadGym finds one gym or null', async () => {
    const fake = createFakeSocialClient({ gyms: [...GYMS], gym_members: [{ user_id: 'pat', gym_id: 'g2', joined_at: 'x' }] });
    expect(await gymOf(fake.client, 'pat')).toEqual(GYMS[1]);
    expect(await loadGym(fake.client, 'g1')).toEqual(GYMS[0]);
    expect(await loadGym(fake.client, 'nope')).toBeNull();
  });

  it('loadGymMembers: newest member first, with names, only this gym’s', async () => {
    const fake = createFakeSocialClient({
      gyms: [...GYMS],
      profiles: [profile('pat', 'pat_pulls', 'Pat'), profile('olly', 'olly', 'Olly'), profile('sam', 'sam', 'Sam')],
      gym_members: [
        { user_id: 'pat', gym_id: 'g1', joined_at: '2026-11-16T08:00:00.000Z' },
        { user_id: 'olly', gym_id: 'g1', joined_at: '2026-11-16T09:00:00.000Z' },
        { user_id: 'sam', gym_id: 'g2', joined_at: '2026-11-16T10:00:00.000Z' },
      ],
    });
    const members = await loadGymMembers(fake.client, 'g1');
    expect(members.map((m) => m.userId)).toEqual(['olly', 'pat']);
    expect(members[1]).toEqual(expect.objectContaining({ username: 'pat_pulls', displayName: 'Pat' }));
  });

  it('every read throws when the server can’t be reached', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(gymOf(fake.client, 'me')).rejects.toThrow();
    await expect(loadGym(fake.client, 'g1')).rejects.toThrow();
    await expect(loadGymMembers(fake.client, 'g1')).rejects.toThrow();
  });
});

describe('formatDistance', () => {
  it('one decimal under 10 miles, whole miles from 10 up', () => {
    expect(formatDistance(1393)).toBe('0.9 mi'); // the fixture's Capitol Hill gym from downtown
    expect(formatDistance(0)).toBe('0.0 mi');
    expect(formatDistance(9.4 * METRES_PER_MILE)).toBe('9.4 mi');
    expect(formatDistance(9.96 * METRES_PER_MILE)).toBe('10 mi');
    expect(formatDistance(38889)).toBe('24 mi'); // Boulder from downtown
  });

  it('never shows a negative distance', () => {
    expect(formatDistance(-5)).toBe('0.0 mi');
  });
});
