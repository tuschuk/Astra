/**
 * Teams (B36 — TEAM-1, TEAM-2): every read and write the app makes about teams, in one place.
 *
 * What a team is: a named group of lifters with a shared feed. Anyone can create one; it starts
 * **open** (any lifter can join) and its creator — the team's **owner** — can switch it to
 * **invite-only**, after which only lifters the owner invited can join. Members can leave; the
 * owner can't (a team is never left without one).
 *
 * Why this file exists: the Teams screens (Communities, the team page, the invite screen, Home's
 * team chips and the profile's Teams section) all need the same handful of questions answered.
 * Writing each request once here means the rules about shapes and refusals live once too.
 *
 * Who may do what is NOT decided here. Teams live only on the server (they are never stored on
 * the phone — joining needs a connection, like votes), every request runs as the signed-in
 * lifter, and the server's row-level security answers: it refuses a join of an invite-only team
 * without an invite, a mode switch by anyone but the owner, and an owner leaving. This file just
 * asks, and turns a refusal into a calm sentence. The Supabase client is passed in, so tests
 * hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertValidTeamName, MAX_TEAM_NAME_LENGTH } from '@training-math';

import { throwIfError } from '@/lib/throwIfError';

import { MIN_SEARCH_LENGTH, SEARCH_LIMIT, sanitizeSearchTerm } from './follows';
import type { PersonName } from './names';

/** How a team lets people in: anyone (`open`, the default) or invited lifters only (`invite`). */
export type TeamJoinMode = 'open' | 'invite';

/**
 * A member's role. The owner and coaches coach the team (B37): they push content, assign
 * programs and can read members' training logs. Only the owner changes roles.
 */
export type TeamRole = 'owner' | 'coach' | 'member';

/** One team as the app shows it. */
export interface Team {
  id: string;
  name: string;
  joinMode: TeamJoinMode;
  /** Who made it (its owner, in B36). */
  createdBy: string;
}

/** A team someone belongs to, with their role in it (Home chips, Communities, the profile). */
export interface TeamMembership {
  team: Team;
  role: TeamRole;
}

/** One person on a team's roster. */
export interface TeamMember extends PersonName {
  userId: string;
  role: TeamRole;
  /** Their photo's path in the avatars bucket, or null. */
  avatarPath: string | null;
}

/** How a team action went: done, or a sentence for the lifter. */
export type TeamResult = { ok: true } | { ok: false; message: string };

/** Shown when the server refuses a join — the team is invite-only and the lifter has no invite. */
export const TEAM_JOIN_REFUSED = 'This team is invite-only. Ask its owner for an invite.';

/** Shown when the server refuses something only the owner may do (or an owner tries to leave). */
export const TEAM_NOT_ALLOWED = 'Only the team’s owner can do that.';

/** Shown when the owner tries to invite someone across a block. */
export const TEAM_INVITE_REFUSED = 'You can’t invite this lifter.';

/** Shown when the request didn't get through at all. */
export const TEAM_FAILED = 'That didn’t go through. Check your connection and try again.';

/** The team columns every read asks for. */
export const TEAM_SELECT = 'id,name,join_mode,created_by';

/** A team row exactly as the server sends it for `TEAM_SELECT`. */
export interface RawTeam {
  id: string;
  name: string;
  join_mode: TeamJoinMode;
  created_by: string;
}

/** A membership row with its team embedded (`loadTeamsOf`). */
interface RawMembership {
  role: TeamRole;
  team: RawTeam | null;
}

/** A roster row with the member's profile embedded (`loadTeamMembers`). */
interface RawMember {
  user_id: string;
  role: TeamRole;
  profile: { username: string | null; display_name: string | null; avatar_url?: string | null } | null;
}

/** The roster read: the member's profile named through its foreign key (unambiguous on the server). */
export const MEMBER_SELECT =
  'user_id,role,joined_at,profile:profiles!team_members_user_id_fkey(username,display_name,avatar_url)';

/** Turns a server team row into the app's shape. */
export function toTeam(raw: RawTeam): Team {
  return { id: raw.id, name: raw.name, joinMode: raw.join_mode, createdBy: raw.created_by };
}

/** The line any Teams screen shows when it can't reach the server. */
export const TEAMS_OFFLINE = 'Teams need a connection. Logging workouts and the Tool Kit still work offline.';

/** Postgres's "that row already exists" code (a repeat join or invite). Shared with teamCoaching.ts. */
export const UNIQUE_VIOLATION = '23505';
/** Postgres's "a security rule refused this row" code. Shared with teamCoaching.ts. */
export const RLS_REFUSED = '42501';

/** Postgres's error code on a refused request, if there is one. */
export function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/**
 * Creates a team named `name` (trimmed) owned by `me`. The server adds the owner's membership
 * row itself, in the same step, so the new team already lists `me` as its owner. The name is
 * checked against the server's 1–80 character rule first, so a bad name never makes a request.
 * Returns the new team, or a sentence.
 */
export async function createTeam(
  client: SupabaseClient,
  me: string,
  name: string,
): Promise<{ ok: true; team: Team } | { ok: false; message: string }> {
  const trimmed = name.trim();
  try {
    assertValidTeamName(trimmed);
  } catch {
    return { ok: false, message: `Give the team a name of 1 to ${MAX_TEAM_NAME_LENGTH} characters.` };
  }
  try {
    const { data, error } = await client.from('teams').insert({ created_by: me, name: trimmed }).select(TEAM_SELECT).single();
    if (error || !data) return { ok: false, message: TEAM_FAILED };
    return { ok: true, team: toTeam(data as unknown as RawTeam) };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * The teams `userId` belongs to, with their role in each, sorted by team name. For your own id
 * that is every team you are in; for someone else's (their profile) the server returns only
 * what you may see — their open teams, and invite-only teams you are in too. Throws on failure.
 */
export async function loadTeamsOf(client: SupabaseClient, userId: string): Promise<TeamMembership[]> {
  const { data, error } = await client.from('team_members').select(`role,team:teams(${TEAM_SELECT})`).eq('user_id', userId);
  throwIfError(error, 'Loading teams failed');
  const rows = (data ?? []) as unknown as RawMembership[];
  return rows
    .flatMap((r) => (r.team ? [{ team: toTeam(r.team), role: r.role }] : []))
    .sort((a, b) => a.team.name.localeCompare(b.team.name));
}

/** One team by id, or null when there is no such team. Throws on failure. */
export async function loadTeam(client: SupabaseClient, teamId: string): Promise<Team | null> {
  const { data, error } = await client.from('teams').select(TEAM_SELECT).eq('id', teamId).limit(1);
  throwIfError(error, 'Loading the team failed');
  const row = ((data ?? []) as unknown as RawTeam[])[0];
  return row ? toTeam(row) : null;
}

/**
 * A team's roster, oldest member first, with names. What comes back is what the server lets
 * the viewer see: the whole roster for a member or an open team; for an invite-only team you
 * aren't in, only your own row (so: nothing). Throws on failure.
 */
export async function loadTeamMembers(client: SupabaseClient, teamId: string): Promise<TeamMember[]> {
  const { data, error } = await client
    .from('team_members')
    .select(MEMBER_SELECT)
    .eq('team_id', teamId)
    .order('joined_at', { ascending: true });
  throwIfError(error, 'Loading the members failed');
  return ((data ?? []) as unknown as RawMember[]).map((r) => ({
    userId: r.user_id,
    role: r.role,
    username: r.profile?.username ?? null,
    displayName: r.profile?.display_name ?? null,
    avatarPath: r.profile?.avatar_url ?? null,
  }));
}

/**
 * Teams whose name contains `query` (any case), for Communities' Find teams — at most twenty,
 * by name. Uses the same search-text cleaning as Find lifters. Returns [] for a query under two
 * characters. Throws on failure.
 */
export async function searchTeams(client: SupabaseClient, query: string): Promise<Team[]> {
  if (query.trim().length < MIN_SEARCH_LENGTH) return [];
  const term = sanitizeSearchTerm(query);
  if (term.length === 0) return [];
  const { data, error } = await client
    .from('teams')
    .select(TEAM_SELECT)
    .or(`name.ilike."%${term}%"`)
    .order('name', { ascending: true })
    .limit(SEARCH_LIMIT);
  throwIfError(error, 'Searching teams failed');
  return ((data ?? []) as unknown as RawTeam[]).map(toTeam);
}

/**
 * `me` joins a team as a plain member. Already a member counts as success. The server refuses
 * an invite-only team without an invite — that comes back as `TEAM_JOIN_REFUSED`. Joining with
 * an invite uses the invite up (the server deletes it).
 *
 * One wrinkle: the server checks its security rule before the "already a member" rule, so a
 * repeat join of an invite-only team (a double tap — the first join used the invite up) is
 * refused as if uninvited. On a refusal this asks once whether `me` is in fact a member, and if
 * so reports success instead of a wrong "invite-only" sentence.
 */
export async function joinTeam(client: SupabaseClient, me: string, teamId: string): Promise<TeamResult> {
  try {
    const { error } = await client.from('team_members').insert({ team_id: teamId, user_id: me });
    if (!error) return { ok: true };
    if (codeOf(error) === UNIQUE_VIOLATION) return { ok: true };
    if (codeOf(error) === RLS_REFUSED) {
      const mine = await client.from('team_members').select('team_id').eq('team_id', teamId).eq('user_id', me);
      if (!mine.error && ((mine.data ?? []) as unknown[]).length > 0) return { ok: true };
      return { ok: false, message: TEAM_JOIN_REFUSED };
    }
    return { ok: false, message: TEAM_FAILED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * `me` leaves a team. The server never lets the owner leave (it silently removes nothing), so
 * the request asks for the removed row back: none removed means "not allowed".
 */
export async function leaveTeam(client: SupabaseClient, me: string, teamId: string): Promise<TeamResult> {
  try {
    const { data, error } = await client
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', me)
      .select('team_id');
    if (error) return { ok: false, message: TEAM_FAILED };
    return ((data ?? []) as unknown[]).length > 0 ? { ok: true } : { ok: false, message: TEAM_NOT_ALLOWED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * The owner's switch between open and invite-only (TEAM-1). Anyone else's attempt changes
 * nothing on the server — the request asks for the changed row back, so "nothing changed" comes
 * back as `TEAM_NOT_ALLOWED`. The screen only shows the switch to the owner; this is the check
 * that matters.
 */
export async function setJoinMode(client: SupabaseClient, teamId: string, mode: TeamJoinMode): Promise<TeamResult> {
  try {
    const { data, error } = await client.from('teams').update({ join_mode: mode }).eq('id', teamId).select('id');
    if (error) return { ok: false, message: TEAM_FAILED };
    return ((data ?? []) as unknown[]).length > 0 ? { ok: true } : { ok: false, message: TEAM_NOT_ALLOWED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * The owner makes a member a coach, or a coach a plain member again (TEAM-3, B37). Coaches can
 * push programs, workouts and announcements to the team, assign programs, and read members'
 * training logs. The server only lets the team's owner change roles, never touches the owner's
 * own row, and never makes a second owner — anything else changes nothing, which comes back as
 * `TEAM_NOT_ALLOWED` (the request asks for the changed row back).
 */
export async function setMemberRole(
  client: SupabaseClient,
  teamId: string,
  userId: string,
  role: 'coach' | 'member',
): Promise<TeamResult> {
  try {
    const { data, error } = await client
      .from('team_members')
      .update({ role })
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .select('user_id');
    if (error) return { ok: false, message: TEAM_FAILED };
    return ((data ?? []) as unknown[]).length > 0 ? { ok: true } : { ok: false, message: TEAM_NOT_ALLOWED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/** True for the roles that coach a team: the owner (always a coach) and coaches (B37). */
export function isCoachRole(role: TeamRole | null): boolean {
  return role === 'owner' || role === 'coach';
}

/** The teams that have invited `me` and that `me` hasn't joined yet (joining uses an invite up). Throws on failure. */
export async function myInvites(client: SupabaseClient, me: string): Promise<Team[]> {
  const { data, error } = await client.from('team_invites').select(`team:teams(${TEAM_SELECT})`).eq('user_id', me);
  throwIfError(error, 'Loading invites failed');
  return ((data ?? []) as unknown as { team: RawTeam | null }[]).flatMap((r) => (r.team ? [toTeam(r.team)] : []));
}

/**
 * Who a team has invited (and who hasn't joined yet), as user ids — the invite screen's
 * "Invited" marks. The server shows a team's invites only to its owner. Throws on failure.
 */
export async function teamInvitees(client: SupabaseClient, teamId: string): Promise<Set<string>> {
  const { data, error } = await client.from('team_invites').select('user_id').eq('team_id', teamId);
  throwIfError(error, 'Loading invites failed');
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
}

/**
 * The owner invites `userId` to the team. Inviting twice is harmless. The server refuses anyone
 * but the owner (`TEAM_NOT_ALLOWED`)… and an invite across a block, which looks the same from
 * here, so a refusal says the neutral `TEAM_INVITE_REFUSED`.
 */
export async function inviteToTeam(client: SupabaseClient, teamId: string, userId: string): Promise<TeamResult> {
  try {
    const { error } = await client.from('team_invites').insert({ team_id: teamId, user_id: userId });
    if (!error) return { ok: true };
    if (codeOf(error) === UNIQUE_VIOLATION) return { ok: true };
    if (codeOf(error) === RLS_REFUSED) return { ok: false, message: TEAM_INVITE_REFUSED };
    return { ok: false, message: TEAM_FAILED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/**
 * Removes the invite of `userId` to the team — the owner cancelling it, or (with your own id)
 * you declining it. An invite already gone is no error.
 */
export async function removeInvite(client: SupabaseClient, teamId: string, userId: string): Promise<TeamResult> {
  try {
    const { error } = await client.from('team_invites').delete().eq('team_id', teamId).eq('user_id', userId);
    return error ? { ok: false, message: TEAM_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/** The words for a join mode on a team row ("Open" / "Invite only"). */
export function joinModeLabel(mode: TeamJoinMode): string {
  return mode === 'open' ? 'Open' : 'Invite only';
}

/** The words for a role on a team row ("Owner" / "Coach" / "Member"). */
export function roleLabel(role: TeamRole): string {
  return role === 'owner' ? 'Owner' : role === 'coach' ? 'Coach' : 'Member';
}
