/**
 * Tests for the owner's Invite lifters screen (B36): an owner searches, invites a lifter (one
 * invite row), cancels it again, and sees current members marked instead of a button; a
 * non-owner gets the owner-only line and no search. The client is the in-memory fake.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';
import { renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import InviteToTeamScreen, { INVITE_OWNER_ONLY } from '@/app/team/[id]/invite';

let mockSocial = createFakeSocialClient();
jest.mock('@/lib/supabase', () => ({
  ...jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase'),
  getSupabase: () => mockSocial.client,
}));

let mockTeamId = 'mine';
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
    useLocalSearchParams: () => ({ id: mockTeamId }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = SIGNED_IN_USER_ID;

beforeEach(() => {
  jest.clearAllMocks();
  mockTeamId = 'mine';
  mockSocial = createFakeSocialClient({
    profiles: [profile(ME, 'me_lifts', 'Me'), profile('sam', 'samantha', 'Samantha'), profile('sid', 'sam_sid', 'Sid')],
    teams: [
      { id: 'mine', name: 'My Crew', join_mode: 'invite', created_by: ME },
      { id: 'theirs', name: 'Their Crew', join_mode: 'open', created_by: 'sam' },
    ],
    team_members: [
      { team_id: 'mine', user_id: ME, role: 'owner', joined_at: '2026-11-15T10:00:00.000Z' },
      { team_id: 'mine', user_id: 'sid', role: 'member', joined_at: '2026-11-15T11:00:00.000Z' },
      { team_id: 'theirs', user_id: 'sam', role: 'owner', joined_at: '2026-11-15T10:00:00.000Z' },
      { team_id: 'theirs', user_id: ME, role: 'member', joined_at: '2026-11-15T11:00:00.000Z' },
    ],
  });
});

describe('Invite lifters', () => {
  it('the owner invites a lifter, cancels the invite, and sees members marked', async () => {
    await renderSignedIn(<InviteToTeamScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Search lifters'), 'sam');
    await fireEvent.press(await screen.findByLabelText('Invite Samantha'));
    expect(await screen.findByLabelText('Cancel invite for Samantha')).toBeTruthy();
    expect(mockSocial.tables.team_invites).toEqual([{ team_id: 'mine', user_id: 'sam' }]);
    // Sid is already on the team: a label, not a button.
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.queryByLabelText('Invite Sid')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Cancel invite for Samantha'));
    expect(await screen.findByLabelText('Invite Samantha')).toBeTruthy();
    expect(mockSocial.tables.team_invites).toEqual([]);
  });

  it('a member who is not the owner gets the owner-only line and no search', async () => {
    mockTeamId = 'theirs';
    await renderSignedIn(<InviteToTeamScreen />);
    expect(await screen.findByText(INVITE_OWNER_ONLY)).toBeTruthy();
    expect(screen.queryByLabelText('Search lifters')).toBeNull();
  });

  it('a team that doesn’t exist says so, not "owner only"', async () => {
    mockTeamId = 'gone';
    await renderSignedIn(<InviteToTeamScreen />);
    expect(await screen.findByText('This team isn’t available.')).toBeTruthy();
    expect(screen.queryByText(INVITE_OWNER_ONLY)).toBeNull();
  });
});
