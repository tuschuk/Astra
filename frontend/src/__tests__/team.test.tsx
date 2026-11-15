/**
 * Tests for the team page and the create form (B36). The step's definition of done, app side:
 * both join modes work (open → Join; invite-only → refused without an invite, Join with one),
 * only the owner sees the join-mode switch and it changes the team, and the Team feed shows
 * members' posts and never a non-member's (TEAM-2). Also Leave (not for the owner), the closed
 * view of an invite-only team, a missing team, and New team → the new team's page. The client is
 * the in-memory fake social client; owner-only enforcement itself was probed live.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import type { SqlDriver } from '@/db/driver';
import type { FeedPost } from '@/social/feed';
import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile, rawPost } from '@/test-utils/feedFixtures';
import { createPreparedDb, renderSignedIn, SIGNED_IN_USER_ID } from '@/test-utils/loggerTestKit';

import TeamScreen, { TEAM_CLOSED_LINE, TEAM_MISSING } from '@/app/team/[id]/index';
import NewTeamScreen from '@/app/team/new';

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

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockTeamId = 'open';
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: mockTeamId }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = SIGNED_IN_USER_ID;
const olly = profile('owner', 'olly', 'Olly');
const pat = profile('pat', 'pat_pulls', 'Pat');
const stranger = profile('stranger', 'stranger_lifts', 'Stranger');
const me = profile(ME, 'me_lifts', 'Me');

const team = (id: string, name: string, joinMode: 'open' | 'invite', createdBy = 'owner') => ({
  id,
  name,
  join_mode: joinMode,
  created_by: createdBy,
  created_at: '2026-11-15T10:00:00.000Z',
});
const member = (teamId: string, userId: string, role = 'member', joinedAt = '2026-11-15T11:00:00.000Z') => ({
  team_id: teamId,
  user_id: userId,
  role,
  joined_at: joinedAt,
});

/** The posts the Team feed list holds, in order. */
function listedPosts(): FeedPost[] {
  return screen.getByTestId('team-feed').props.data as FeedPost[];
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockOpenDatabase.mockResolvedValue(await createPreparedDb());
  mockTeamId = 'open';
  mockSocial = createFakeSocialClient({
    profiles: [olly, pat, stranger, me],
    teams: [team('open', 'Iron Tribe', 'open'), team('closed', 'Iron Circle', 'invite'), team('mine', 'My Crew', 'open', ME)],
    team_members: [
      member('open', 'owner', 'owner', '2026-11-15T10:00:00.000Z'),
      member('open', 'pat'),
      member('closed', 'owner', 'owner'),
      member('closed', 'pat'),
      member('mine', ME, 'owner'),
    ],
    posts: [
      rawPost({ id: 'pat-post', author: pat, createdAt: '2026-11-15T09:00:00.000Z', title: 'Pat squats' }),
      rawPost({ id: 'olly-post', author: olly, createdAt: '2026-11-15T08:00:00.000Z', title: 'Olly benches' }),
      rawPost({ id: 'stranger-post', author: stranger, createdAt: '2026-11-15T10:00:00.000Z', title: 'Stranger pulls' }),
    ],
  });
});

describe('team page', () => {
  it('Team feed: members’ posts newest first, never a non-member’s (TEAM-2); roster listed', async () => {
    await renderSignedIn(<TeamScreen />);
    expect(await screen.findByText('Pat squats')).toBeTruthy();
    expect(listedPosts().map((p) => p.id)).toEqual(['pat-post', 'olly-post']);
    expect(screen.queryByText('Stranger pulls')).toBeNull();
    expect(screen.getByText('2 members')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Open Pat's profile"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/profile/[id]', params: { id: 'pat' } });
  });

  it('open team: Join makes me a member; Leave takes me out again (TEAM-1)', async () => {
    await renderSignedIn(<TeamScreen />);
    await fireEvent.press(await screen.findByLabelText('Join team'));
    expect(await screen.findByLabelText('Leave team')).toBeTruthy();
    expect(screen.getByText('3 members')).toBeTruthy();
    expect(mockSocial.tables.team_members).toContainEqual(expect.objectContaining({ team_id: 'open', user_id: ME, role: 'member' }));
    // A member sees no owner switch.
    expect(screen.queryByLabelText('Invite only: only invited lifters can join')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Leave team'));
    expect(await screen.findByLabelText('Join team')).toBeTruthy();
    expect(mockSocial.tables.team_members.some((m) => m.team_id === 'open' && m.user_id === ME)).toBe(false);
  });

  it('invite-only, not invited: only the name and the closed line — no Join, roster or feed', async () => {
    mockTeamId = 'closed';
    await renderSignedIn(<TeamScreen />);
    expect(await screen.findByText(TEAM_CLOSED_LINE)).toBeTruthy();
    expect(screen.getByText('Iron Circle')).toBeTruthy();
    expect(screen.queryByLabelText('Join team')).toBeNull();
    expect(screen.queryByText('2 members')).toBeNull();
    expect(listedPosts()).toEqual([]);
    // The feed is not even asked for.
    expect(mockSocial.requests.some((r) => r[0][1] === 'posts')).toBe(false);
  });

  it('invite-only, invited: “You’re invited — Join” joins and shows the feed; the invite is used up', async () => {
    mockTeamId = 'closed';
    mockSocial.tables.team_invites.push({ team_id: 'closed', user_id: ME });
    await renderSignedIn(<TeamScreen />);
    await fireEvent.press(await screen.findByLabelText('You’re invited — Join'));
    expect(await screen.findByText('Pat squats')).toBeTruthy();
    expect(screen.getByLabelText('Leave team')).toBeTruthy();
    expect(mockSocial.tables.team_invites).toEqual([]);
  });

  it('owner: sees the switch (which changes the team) and Invite lifters, and no Leave', async () => {
    mockTeamId = 'mine';
    await renderSignedIn(<TeamScreen />);
    const inviteOnly = await screen.findByLabelText('Invite only: only invited lifters can join');
    expect(screen.getByLabelText('Open: anyone can join').props.accessibilityState?.selected).toBe(true);
    expect(screen.queryByLabelText('Leave team')).toBeNull();

    await fireEvent.press(inviteOnly);
    expect(await screen.findByText('Invite only · You: Owner')).toBeTruthy();
    expect(mockSocial.tables.teams.find((t) => t.id === 'mine')?.join_mode).toBe('invite');

    await fireEvent.press(screen.getByLabelText('Invite lifters'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/team/[id]/invite', params: { id: 'mine' } });
  });

  it('a team that doesn’t exist says so', async () => {
    mockTeamId = 'gone';
    await renderSignedIn(<TeamScreen />);
    expect(await screen.findByText(TEAM_MISSING)).toBeTruthy();
  });

  it('offline: the connection message with Retry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSocial.setOffline(true);
    await renderSignedIn(<TeamScreen />);
    expect(await screen.findByText(/Teams need a connection/)).toBeTruthy();
    mockSocial.setOffline(false);
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Pat squats')).toBeTruthy();
    warn.mockRestore();
  });
});

describe('New team', () => {
  it('creates an open team owned by me and replaces itself with the team’s page', async () => {
    await renderSignedIn(<NewTeamScreen />);
    expect(screen.getByLabelText('Create team').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Team name'), '  Dawn Patrol  ');
    await fireEvent.press(screen.getByLabelText('Create team'));
    const created = mockSocial.tables.teams.find((t) => t.name === 'Dawn Patrol');
    expect(created).toEqual(expect.objectContaining({ created_by: ME, join_mode: 'open' }));
    expect(mockSocial.tables.team_members).toContainEqual(expect.objectContaining({ team_id: created?.id, user_id: ME, role: 'owner' }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/team/[id]', params: { id: created?.id } });
  });

  it('a name past 80 characters is refused on screen', async () => {
    await renderSignedIn(<NewTeamScreen />);
    await fireEvent.changeText(screen.getByLabelText('Team name'), 'x'.repeat(81));
    expect(screen.getByText('Names can be at most 80 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Create team').props.accessibilityState?.disabled).toBe(true);
  });
});
