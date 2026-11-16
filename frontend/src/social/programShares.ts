/**
 * Program shares (B39 — PRG-4): which Teams one of the lifter's programs is shared with.
 *
 * What it's for: a program whose visibility is "Team" can be seen by the members of every Team
 * the author shared it with. This file reads that list and adds or removes one Team at a time.
 * The program page's "Who can see this" section is its only caller.
 *
 * Why it's online-only: the list lives on the server only (table `program_team_shares`), never on
 * the phone — a share is a link to a Team, and Teams themselves are online-only (B36). The
 * program's visibility setting itself IS stored on the phone and works offline
 * (`programs/programs.ts` `setProgramVisibility`); only this Team list needs a connection.
 *
 * Who may do what is NOT decided here. The server's security rules let only the author share or
 * unshare their program, and only with a Team they belong to. This file asks, and turns a refusal
 * into a calm sentence. The Supabase client is passed in, so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { throwIfError } from '@/lib/throwIfError';

import { codeOf, RLS_REFUSED, TEAM_FAILED, UNIQUE_VIOLATION, type TeamResult } from './teams';

/**
 * Shown when the server refuses a share. Either the lifter isn't in that Team, or the program was
 * made on this phone a moment ago and hasn't reached the server yet (the server can't see it's
 * theirs until it has).
 */
export const PROGRAM_SHARE_REFUSED =
  'You can only share with teams you’re in. If you just made this program, wait for it to sync and try again.';

/** The ids of the Teams program `programId` is shared with. Throws on failure (e.g. offline). */
export async function listProgramShares(client: SupabaseClient, programId: string): Promise<Set<string>> {
  const { data, error } = await client.from('program_team_shares').select('team_id').eq('program_id', programId);
  throwIfError(error, 'Loading the program’s teams failed');
  return new Set(((data ?? []) as { team_id: string }[]).map((r) => r.team_id));
}

/**
 * Shares program `programId` with Team `teamId`. Sharing it twice is fine (already shared counts
 * as done). A refusal by the server's rules comes back as `PROGRAM_SHARE_REFUSED`; anything else
 * (no connection) as the usual "didn't go through" sentence.
 */
export async function shareProgramWithTeam(client: SupabaseClient, programId: string, teamId: string): Promise<TeamResult> {
  try {
    const { error } = await client.from('program_team_shares').insert({ program_id: programId, team_id: teamId });
    if (!error || codeOf(error) === UNIQUE_VIOLATION) return { ok: true };
    if (codeOf(error) === RLS_REFUSED) return { ok: false, message: PROGRAM_SHARE_REFUSED };
    return { ok: false, message: TEAM_FAILED };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}

/** Stops sharing program `programId` with Team `teamId`. Not shared already counts as done. */
export async function unshareProgramFromTeam(client: SupabaseClient, programId: string, teamId: string): Promise<TeamResult> {
  try {
    const { error } = await client.from('program_team_shares').delete().eq('program_id', programId).eq('team_id', teamId);
    return error ? { ok: false, message: TEAM_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: TEAM_FAILED };
  }
}
