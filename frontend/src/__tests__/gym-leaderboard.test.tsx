/**
 * Tests for a gym's leaderboard screen (B52). The step's definition of done, app side, with
 * fixture entries: each board shows exactly two divisions ("Men" and "Women") ranked by absolute
 * weight, one row per member, and a member's rows stay on the old gym's board after they switch
 * gyms while the new gym's board shows nothing for them. Also: the lift chips each read their
 * own board, names open profiles, weights show in the viewer's unit, an empty division says so,
 * a missing gym, and the offline state with Retry. The client is the in-memory fake social
 * client; who may write the board (nobody) was probed live at B52.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import { joinGym, GYM_MISSING, GYMS_OFFLINE } from '@/social/gyms';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { BOARD_EMPTY } from '@/social/leaderboards';
import { createPreparedDb, renderSignedIn } from '@/test-utils/loggerTestKit';

import GymLeaderboardScreen from '@/app/gym/[id]/leaderboard';

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

let mockUnit: 'kg' | 'lb' = 'kg';
jest.mock('@/settings/displayUnit', () => ({ useDisplayUnit: () => mockUnit }));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockGymId = 'rino';
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockGymId }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const gym = (id: string, name: string) => ({ id, name, address: `${name}, Denver, CO` });
/** A fixture board row (verified rows come only from B53; these stand in for them). */
const entry = (id: string, gymId: string, userId: string, lift: string, division: string, weightKg: number, verifiedAt: string) => ({
  id,
  gym_id: gymId,
  user_id: userId,
  lift,
  division,
  weight_kg: weightKg,
  verified_at: verifiedAt,
});

/** The row labels in one division section, top to bottom. */
function rowsIn(divisionLabel: 'Men' | 'Women'): string[] {
  const section = screen.getByTestId(divisionLabel === 'Men' ? 'division-male' : 'division-female');
  return within(section)
    .queryAllByRole('button')
    .map((b) => String(b.props.accessibilityLabel));
}

/** The division section headers on screen, in order (the gym's name is a header too, so it's left out). */
function divisionHeaders(): string[] {
  return screen
    .getAllByRole('header')
    .map((h) => String(h.props.children))
    .filter((text) => text === 'Men' || text === 'Women');
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockOpenDatabase.mockResolvedValue(await createPreparedDb());
  mockGymId = 'rino';
  mockUnit = 'kg';
  mockSocial = createFakeSocialClient({
    profiles: [profile('ann', 'ann', 'Ann'), profile('bo', 'bo', 'Bo'), profile('cy', 'cy', 'Cy'), profile('di', 'di', 'Di')],
    gyms: [gym('rino', 'RiNo'), gym('highlands', 'Highlands')],
    gym_members: [
      { user_id: 'ann', gym_id: 'rino', joined_at: '2026-11-01T00:00:00.000Z' },
      { user_id: 'bo', gym_id: 'rino', joined_at: '2026-11-01T00:00:00.000Z' },
      { user_id: 'cy', gym_id: 'rino', joined_at: '2026-11-01T00:00:00.000Z' },
    ],
    leaderboard_entries: [
      entry('s-ann', 'rino', 'ann', 'squat', 'female', 140, '2026-11-08T00:00:00.000Z'),
      entry('s-bo', 'rino', 'bo', 'squat', 'male', 200, '2026-11-10T00:00:00.000Z'),
      entry('s-cy', 'rino', 'cy', 'squat', 'male', 200, '2026-11-09T00:00:00.000Z'),
      entry('s-di', 'rino', 'di', 'squat', 'male', 180, '2026-11-01T00:00:00.000Z'),
      entry('b-bo', 'rino', 'bo', 'bench', 'male', 130, '2026-11-10T00:00:00.000Z'),
      entry('s-hl', 'highlands', 'ann', 'squat', 'female', 300, '2026-11-01T00:00:00.000Z'),
    ],
  });
});

describe('gym leaderboard', () => {
  it('two divisions ranked by absolute weight, one row per member; an earlier verification wins a tie (step DoD)', async () => {
    await renderSignedIn(<GymLeaderboardScreen />);
    expect(await screen.findByRole('header', { name: 'Men' })).toBeTruthy();
    expect(screen.getByText('RiNo')).toBeTruthy();
    expect(divisionHeaders()).toEqual(['Men', 'Women']);
    // Cy and Bo both squat 200; Cy verified first. Di's 180 is next. Other gyms never mix in.
    expect(rowsIn('Men')).toEqual([
      "1. Cy, 200 kg. Open Cy's profile",
      "2. Bo, 200 kg. Open Bo's profile",
      "3. Di, 180 kg. Open Di's profile",
    ]);
    expect(rowsIn('Women')).toEqual(["1. Ann, 140 kg. Open Ann's profile"]);
  });

  it('each lift chip reads its own board; an empty division still shows its header and says so', async () => {
    await renderSignedIn(<GymLeaderboardScreen />);
    await screen.findByRole('header', { name: 'Men' });
    await fireEvent.press(screen.getByLabelText('Bench press leaderboard'));
    await waitFor(() => expect(rowsIn('Men')).toEqual(["1. Bo, 130 kg. Open Bo's profile"]));
    expect(screen.getByRole('header', { name: 'Women' })).toBeTruthy();
    expect(screen.getByText(BOARD_EMPTY)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Deadlift leaderboard'));
    await waitFor(() => expect(screen.getAllByText(BOARD_EMPTY)).toHaveLength(2));
    expect(divisionHeaders()).toEqual(['Men', 'Women']);

    const liftsAsked = mockSocial.requests
      .filter((r) => r[0][1] === 'leaderboard_entries')
      .map((r) => r.find(([m, col]) => m === 'eq' && col === 'lift')?.[2]);
    expect(liftsAsked).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('weights show in the viewer’s unit; a name opens that lifter’s profile', async () => {
    mockUnit = 'lb';
    await renderSignedIn(<GymLeaderboardScreen />);
    await screen.findByRole('header', { name: 'Women' });
    expect(rowsIn('Women')).toEqual(["1. Ann, 308.6 lb. Open Ann's profile"]);
    await fireEvent.press(screen.getByLabelText("1. Ann, 308.6 lb. Open Ann's profile"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/profile/[id]', params: { id: 'ann' } });
  });

  it('switching gyms leaves a member’s rows on the old board, untouched (GYM-9, step DoD)', async () => {
    const before = mockSocial.tables.leaderboard_entries.map((r) => ({ ...r }));
    // Bo switches from RiNo to Highlands — the app's real switch request.
    expect(await joinGym(mockSocial.client, 'bo', 'highlands')).toEqual({ ok: true });
    expect(mockSocial.tables.gym_members.find((m) => m.user_id === 'bo')?.gym_id).toBe('highlands');
    // The switch touched memberships only.
    expect(mockSocial.tables.leaderboard_entries).toEqual(before);

    await renderSignedIn(<GymLeaderboardScreen />);
    await screen.findByTestId('division-male');
    expect(rowsIn('Men')).toContain("2. Bo, 200 kg. Open Bo's profile");
  });

  it('after a switch, the new gym’s board starts empty for that member (GYM-9)', async () => {
    expect(await joinGym(mockSocial.client, 'bo', 'highlands')).toEqual({ ok: true });
    mockGymId = 'highlands';
    await renderSignedIn(<GymLeaderboardScreen />);
    expect(await screen.findByText('Highlands')).toBeTruthy();
    await screen.findByTestId('division-male');
    expect(rowsIn('Men')).toEqual([]);
    expect(screen.queryByText('Bo')).toBeNull();
  });

  it('a gym that doesn’t exist says so', async () => {
    mockGymId = 'nope';
    await renderSignedIn(<GymLeaderboardScreen />);
    expect(await screen.findByText(GYM_MISSING)).toBeTruthy();
  });

  it('offline: the connection message; Retry loads the board', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSocial.setOffline(true);
    await renderSignedIn(<GymLeaderboardScreen />);
    expect(await screen.findByText(GYMS_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.getByText('RiNo')).toBeTruthy());
    expect(await screen.findByRole('header', { name: 'Men' })).toBeTruthy();
    warn.mockRestore();
  });
});
