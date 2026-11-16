/**
 * Tests for Communities' Teams half (B36, TEAM-1): Your teams and Invites listed, Join / Decline
 * on an invite (joining uses the invite up), Create a team, Find teams with Join on open teams
 * only, and the offline state with Retry. (B50) The Gyms half: Your gym opens its page, Find
 * your gym opens the directory, and no gym → the explainer card. The Supabase client is the in-memory fake social
 * client (which imitates the join policy); the router is a stub.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import { TEAMS_OFFLINE } from '@/social/teams';

import CommunitiesScreen from '@/app/(tabs)/communities';

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = SIGNED_IN_USER_ID;
const team = (id: string, name: string, joinMode: 'open' | 'invite' = 'open') => ({
  id,
  name,
  join_mode: joinMode,
  created_by: 'owner',
  created_at: '2026-11-15T10:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSocial = createFakeSocialClient({
    teams: [team('mine', 'Dawn Patrol'), team('closed', 'Iron Circle', 'invite'), team('open', 'Iron Tribe')],
    team_members: [
      { team_id: 'mine', user_id: ME, role: 'member', joined_at: '2026-11-15T11:00:00.000Z' },
    ],
    team_invites: [{ team_id: 'closed', user_id: ME }],
  });
});

describe('Communities — Teams', () => {
  it('lists my teams and my invites; tapping a team opens its page', async () => {
    await renderSignedIn(<CommunitiesScreen />);
    expect(await screen.findByText('Dawn Patrol')).toBeTruthy();
    expect(screen.getByText('Open · Member')).toBeTruthy();
    expect(screen.getByText('Iron Circle')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open team Dawn Patrol'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team/[id]', params: { id: 'mine' } });
  });

  it('Join on an invite joins the invite-only team and uses the invite up', async () => {
    await renderSignedIn(<CommunitiesScreen />);
    await fireEvent.press(await screen.findByLabelText('Join Iron Circle'));
    expect(await screen.findByText('Invite only · Member')).toBeTruthy();
    expect(mockSocial.tables.team_members).toContainEqual(expect.objectContaining({ team_id: 'closed', user_id: ME }));
    expect(mockSocial.tables.team_invites).toEqual([]);
    expect(screen.queryByLabelText('Decline Iron Circle')).toBeNull();
  });

  it('Decline removes the invite without joining', async () => {
    await renderSignedIn(<CommunitiesScreen />);
    await fireEvent.press(await screen.findByLabelText('Decline Iron Circle'));
    await screen.findByText('Dawn Patrol');
    expect(screen.queryByText('Iron Circle')).toBeNull();
    expect(mockSocial.tables.team_invites).toEqual([]);
    expect(mockSocial.tables.team_members).toHaveLength(1);
  });

  it('Create a team opens the create form', async () => {
    await renderSignedIn(<CommunitiesScreen />);
    await fireEvent.press(screen.getByLabelText('Create a team'));
    expect(mockPush).toHaveBeenCalledWith('/team/new');
  });

  it('Find teams: results by name; Join only on open teams I am not in', async () => {
    mockSocial.tables.team_invites = [];
    await renderSignedIn(<CommunitiesScreen />);
    await screen.findByText('Dawn Patrol');
    await fireEvent.changeText(screen.getByLabelText('Search teams'), 'iron');
    expect(await screen.findByText('Iron Tribe')).toBeTruthy();
    expect(screen.getByText('Iron Circle')).toBeTruthy();
    // Invite-only: no Join on the row (its page explains).
    expect(screen.queryByLabelText('Join Iron Circle')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Join Iron Tribe'));
    expect(await screen.findAllByText('Open · Member')).toHaveLength(2);
    expect(mockSocial.tables.team_members).toContainEqual(expect.objectContaining({ team_id: 'open', user_id: ME }));
    // Now mine: the search row no longer offers Join.
    expect(screen.queryByLabelText('Join Iron Tribe')).toBeNull();
  });

  it('Find teams: an invite-only team that invited me can be joined from its search row', async () => {
    await renderSignedIn(<CommunitiesScreen />);
    await screen.findByText('Dawn Patrol');
    await fireEvent.changeText(screen.getByLabelText('Search teams'), 'circle');
    // Two rows offer it once the search answers: the invite, and the search result.
    await waitFor(() => expect(screen.getAllByLabelText('Join Iron Circle')).toHaveLength(2));
  });

  it('offline: says Teams need a connection; Retry loads them', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSocial.setOffline(true);
    await renderSignedIn(<CommunitiesScreen />);
    expect(await screen.findByText(TEAMS_OFFLINE)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Dawn Patrol')).toBeTruthy();
    warn.mockRestore();
  });

  it('renders both the Teams and Gyms sections; no gym yet → the explainer card and Find your gym', async () => {
    await renderSignedIn(<CommunitiesScreen />);
    expect(screen.getByText('Teams')).toBeTruthy();
    expect(screen.getByText('Gyms')).toBeTruthy();
    expect(await screen.findByText(/Join your gym/)).toBeTruthy();
    expect(screen.queryByText('Your gym')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Find your gym'));
    expect(mockPush).toHaveBeenCalledWith('/gyms');
  });
});

describe('Communities — Gyms (B50, GYM-2)', () => {
  it('my gym is listed under Your gym and opens its page; no create or manage control exists (GYM-7)', async () => {
    mockSocial.tables.gyms.push({ id: 'g1', name: 'Sample Gym · RiNo', address: 'River North, Denver, CO' });
    mockSocial.tables.gym_members.push({ user_id: ME, gym_id: 'g1', joined_at: '2026-11-16T09:00:00.000Z' });
    await renderSignedIn(<CommunitiesScreen />);
    expect(await screen.findByText('Your gym')).toBeTruthy();
    expect(screen.queryByText(/Join your gym/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Open gym Sample Gym · RiNo'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/gym/[id]', params: { id: 'g1' } });
    expect(screen.queryByText(/Create a gym|Claim|Manage/i)).toBeNull();
  });

  it('offline: never invites a lifter to join a gym (they may have one) — the Teams half shows the connection line', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSocial.setOffline(true);
    await renderSignedIn(<CommunitiesScreen />);
    expect(await screen.findByText(TEAMS_OFFLINE)).toBeTruthy();
    expect(screen.queryByText(/Join your gym/)).toBeNull();
    expect(screen.getByLabelText('Find your gym')).toBeTruthy();
    warn.mockRestore();
  });
});
