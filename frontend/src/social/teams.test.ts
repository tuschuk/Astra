/**
 * Tests for the Teams module (B36): create (name checked first, owner row added by the server),
 * the two join modes (open joins; invite-only refuses without an invite, accepts with one and
 * uses it up), leave (members can, the owner can't), the owner's switch, invites, search, and
 * the reads' shapes. The client is the in-memory fake social client, which imitates the join
 * policy and the two triggers; owner-only rights themselves were probed live at B36.
 */
import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createFakeSocialClient } from '@/test-utils/fakeSocialClient';
import { profile } from '@/test-utils/feedFixtures';

import {
  createTeam,
  inviteToTeam,
  isCoachRole,
  joinModeLabel,
  joinTeam,
  leaveTeam,
  loadTeam,
  loadTeamMembers,
  loadTeamsOf,
  myInvites,
  removeInvite,
  roleLabel,
  searchTeams,
  setJoinMode,
  setMemberRole,
  TEAM_FAILED,
  TEAM_INVITE_REFUSED,
  TEAM_JOIN_REFUSED,
  TEAM_NOT_ALLOWED,
  teamInvitees,
} from './teams';

const team = (id: string, name: string, joinMode: 'open' | 'invite' = 'open', createdBy = 'owner') => ({
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

describe('createTeam', () => {
  it('creates an open team owned by me, trimmed, and the server lists me as owner', async () => {
    const fake = createFakeSocialClient();
    const result = await createTeam(fake.client, 'me', '  Mythical PRs  ');
    expect(result).toEqual({ ok: true, team: { id: 'team-1', name: 'Mythical PRs', joinMode: 'open', createdBy: 'me' } });
    expect(fake.tables.team_members).toEqual([expect.objectContaining({ team_id: 'team-1', user_id: 'me', role: 'owner' })]);
  });

  it('refuses an empty or too-long name without asking the server', async () => {
    const fake = createFakeSocialClient();
    expect((await createTeam(fake.client, 'me', '   ')).ok).toBe(false);
    expect((await createTeam(fake.client, 'me', 'x'.repeat(81))).ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it('offline → the connection sentence', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    expect(await createTeam(fake.client, 'me', 'Team')).toEqual({ ok: false, message: TEAM_FAILED });
  });
});

describe('join modes (TEAM-1)', () => {
  it('open: anyone joins; joining twice is fine', async () => {
    const fake = createFakeSocialClient({ teams: [team('t', 'Open')] });
    expect(await joinTeam(fake.client, 'me', 't')).toEqual({ ok: true });
    expect(await joinTeam(fake.client, 'me', 't')).toEqual({ ok: true });
    expect(fake.tables.team_members).toEqual([expect.objectContaining({ team_id: 't', user_id: 'me', role: 'member' })]);
  });

  it('invite-only: refused without an invite; with one it joins and the invite is used up', async () => {
    const fake = createFakeSocialClient({ teams: [team('t', 'Closed', 'invite')] });
    expect(await joinTeam(fake.client, 'me', 't')).toEqual({ ok: false, message: TEAM_JOIN_REFUSED });
    expect(fake.tables.team_members).toHaveLength(0);

    fake.tables.team_invites.push({ team_id: 't', user_id: 'me' });
    expect(await joinTeam(fake.client, 'me', 't')).toEqual({ ok: true });
    expect(fake.tables.team_members).toHaveLength(1);
    expect(fake.tables.team_invites).toHaveLength(0);

    // A double tap: the invite is gone, so the server's rule refuses — but I am a member already.
    expect(await joinTeam(fake.client, 'me', 't')).toEqual({ ok: true });
    expect(fake.tables.team_members).toHaveLength(1);
  });

  it('the owner switch reports success when a row changed, and not-allowed when none did', async () => {
    const fake = createFakeSocialClient({ teams: [team('t', 'Team')] });
    expect(await setJoinMode(fake.client, 't', 'invite')).toEqual({ ok: true });
    expect(fake.tables.teams[0].join_mode).toBe('invite');
    // The server answers a non-owner's update with no rows; a missing team looks the same here.
    expect(await setJoinMode(fake.client, 'missing', 'open')).toEqual({ ok: false, message: TEAM_NOT_ALLOWED });
  });
});

describe('leaveTeam', () => {
  it('a member leaves; the owner cannot', async () => {
    const fake = createFakeSocialClient({
      teams: [team('t', 'Team')],
      team_members: [member('t', 'owner', 'owner'), member('t', 'me')],
    });
    expect(await leaveTeam(fake.client, 'me', 't')).toEqual({ ok: true });
    expect(await leaveTeam(fake.client, 'owner', 't')).toEqual({ ok: false, message: TEAM_NOT_ALLOWED });
    expect(fake.tables.team_members).toEqual([expect.objectContaining({ user_id: 'owner' })]);
  });
});

describe('invites', () => {
  it('invite, invite again, list from both sides, then cancel', async () => {
    const fake = createFakeSocialClient({ teams: [team('t', 'Team', 'invite')] });
    expect(await inviteToTeam(fake.client, 't', 'pat')).toEqual({ ok: true });
    expect(await inviteToTeam(fake.client, 't', 'pat')).toEqual({ ok: true });
    expect(await teamInvitees(fake.client, 't')).toEqual(new Set(['pat']));
    expect(await myInvites(fake.client, 'pat')).toEqual([{ id: 't', name: 'Team', joinMode: 'invite', createdBy: 'owner' }]);
    expect(await removeInvite(fake.client, 't', 'pat')).toEqual({ ok: true });
    expect(await myInvites(fake.client, 'pat')).toEqual([]);
  });

  it('a refused invite (not the owner, or a block) gets the neutral sentence', async () => {
    // The fake has no signed-in identity, so this refusal is a one-method stand-in for the server's.
    const refusing = {
      from: () => ({ insert: () => Promise.resolve({ error: { code: '42501', message: 'rls' } }) }),
    } as unknown as SupabaseClient;
    expect(await inviteToTeam(refusing, 't', 'pat')).toEqual({ ok: false, message: TEAM_INVITE_REFUSED });
  });
});

describe('reads', () => {
  it('loadTeamsOf: my teams with my role, by name', async () => {
    const fake = createFakeSocialClient({
      teams: [team('b', 'Bravo'), team('a', 'Alpha', 'invite')],
      team_members: [member('b', 'me'), member('a', 'me', 'owner'), member('a', 'other')],
    });
    expect(await loadTeamsOf(fake.client, 'me')).toEqual([
      { team: { id: 'a', name: 'Alpha', joinMode: 'invite', createdBy: 'owner' }, role: 'owner' },
      { team: { id: 'b', name: 'Bravo', joinMode: 'open', createdBy: 'owner' }, role: 'member' },
    ]);
  });

  it('loadTeam: the row, or null', async () => {
    const fake = createFakeSocialClient({ teams: [team('t', 'Team')] });
    expect(await loadTeam(fake.client, 't')).toEqual({ id: 't', name: 'Team', joinMode: 'open', createdBy: 'owner' });
    expect(await loadTeam(fake.client, 'nope')).toBeNull();
  });

  it('loadTeamMembers: oldest first, with names', async () => {
    const fake = createFakeSocialClient({
      profiles: [profile('owner', 'olly', 'Olly'), profile('pat', 'pat_pulls', null, { avatar_url: 'pat/a.jpg' })],
      teams: [team('t', 'Team')],
      team_members: [member('t', 'pat', 'member', '2026-11-15T12:00:00.000Z'), member('t', 'owner', 'owner', '2026-11-15T10:00:00.000Z')],
    });
    expect(await loadTeamMembers(fake.client, 't')).toEqual([
      { userId: 'owner', role: 'owner', username: 'olly', displayName: 'Olly', avatarPath: null },
      { userId: 'pat', role: 'member', username: 'pat_pulls', displayName: null, avatarPath: 'pat/a.jpg' },
    ]);
  });

  it('a failed read throws (the screen shows its connection message)', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    await expect(loadTeamsOf(fake.client, 'me')).rejects.toThrow(/Loading teams failed/);
  });
});

describe('searchTeams', () => {
  it('needs two characters, matches any case, and treats % and _ literally', async () => {
    const fake = createFakeSocialClient({ teams: [team('a', 'Iron Tribe'), team('b', 'Barbell Club'), team('c', '100%_Club')] });
    expect(await searchTeams(fake.client, 'i')).toEqual([]);
    expect((await searchTeams(fake.client, 'club')).map((t) => t.name)).toEqual(['100%_Club', 'Barbell Club']);
    expect((await searchTeams(fake.client, '%_')).map((t) => t.name)).toEqual(['100%_Club']);
    expect(await searchTeams(fake.client, '"()')).toEqual([]);
  });
});

describe('setMemberRole (B37)', () => {
  it('makes a member a coach and back; never changes the owner row or mints an owner', async () => {
    const fake = createFakeSocialClient({
      teams: [team('t1', 'Crew')],
      team_members: [member('t1', 'owner', 'owner'), member('t1', 'pat')],
    });
    expect(await setMemberRole(fake.client, 't1', 'pat', 'coach')).toEqual({ ok: true });
    expect(fake.tables.team_members.find((m) => m.user_id === 'pat')?.role).toBe('coach');
    expect(await setMemberRole(fake.client, 't1', 'pat', 'member')).toEqual({ ok: true });
    expect(await setMemberRole(fake.client, 't1', 'owner', 'member')).toEqual({ ok: false, message: TEAM_NOT_ALLOWED });
    expect(fake.tables.team_members.find((m) => m.user_id === 'owner')?.role).toBe('owner');
    expect(await setMemberRole(fake.client, 't1', 'nobody', 'coach')).toEqual({ ok: false, message: TEAM_NOT_ALLOWED });
  });

  it('reports a dropped connection calmly', async () => {
    const fake = createFakeSocialClient({}, { offline: true });
    expect(await setMemberRole(fake.client, 't1', 'pat', 'coach')).toEqual({ ok: false, message: TEAM_FAILED });
  });

  it('the owner and coaches coach; members do not', () => {
    expect([isCoachRole('owner'), isCoachRole('coach'), isCoachRole('member'), isCoachRole(null)]).toEqual([true, true, false, false]);
  });
});

describe('labels', () => {
  it('says the mode and role in words', () => {
    expect(joinModeLabel('open')).toBe('Open');
    expect(joinModeLabel('invite')).toBe('Invite only');
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('coach')).toBe('Coach');
    expect(roleLabel('member')).toBe('Member');
  });
});
