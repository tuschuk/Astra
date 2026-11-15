/**
 * Following and finding lifters (SOC-7's app half): search for people by name, follow them,
 * unfollow them.
 *
 * Why this exists: the Home feed shows the people you follow, so the app needs a way to find
 * someone and follow them. Follows are one-way (the Strava model) — following someone needs no
 * approval and creates no "friends" state; it is one row saying "A follows B".
 *
 * The server enforces the rules: you can only create follows where you are the follower, and
 * never when either of you has blocked the other. This file just asks, and turns a refusal into
 * a calm sentence. The Supabase client is passed in, so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { throwIfError } from '@/lib/throwIfError';

import type { PersonName } from './names';

/** Fewer characters than this and the search doesn't run (two letters already narrow a lot). */
export const MIN_SEARCH_LENGTH = 2;

/** The most people one search shows. */
export const SEARCH_LIMIT = 20;

/** One person in the search results, and whether the lifter already follows them. */
export interface LifterResult extends PersonName {
  id: string;
  following: boolean;
}

/** How a follow or unfollow went: done, or a sentence for the lifter. */
export type FollowResult = { ok: true } | { ok: false; message: string };

/** Shown when the server refuses a follow because of a block — it says nothing more than that. */
export const FOLLOW_REFUSED = 'You can’t follow this lifter.';

/** Shown when the request didn't get through at all. */
export const FOLLOW_FAILED = 'That didn’t go through. Check your connection and try again.';

/**
 * Makes what the lifter typed safe to put inside the server's search filter, which is written
 * as text where some characters have meanings. Returns the inside of a quoted `ilike` value:
 *   - quotes, backslashes, commas, parentheses and `*` are removed (filter syntax, not names);
 *   - `%` and `_` (which in a name search would mean "anything") are escaped so they match
 *     themselves — `big_lifter` finds `big_lifter`, not `bigXlifter`;
 *   - spaces at either end are trimmed.
 * Returns "" when nothing searchable is left. A strange search finds few people; it never
 * breaks the request.
 */
export function sanitizeSearchTerm(query: string): string {
  const cleaned = query.replace(/["\\,()*]/g, '').trim();
  // `\\\\` in the output is one escaped backslash inside the quoted filter value (PostgREST
  // unescapes it to `\`), which then tells `ilike` to take the next character literally.
  return cleaned.replace(/[%_]/g, (ch) => `\\\\${ch}`);
}

/** The search filter: username or display name contains the term (any case). */
export function searchFilter(term: string): string {
  const pattern = `"%${term}%"`;
  return `username.ilike.${pattern},display_name.ilike.${pattern}`;
}

/**
 * Finds lifters whose username or display name contains `query`, leaving out `me` and anyone
 * `me` has blocked (hiding people you blocked from your own search is a courtesy — the server
 * is what actually keeps blocked people apart; someone who blocked *you* still appears, since
 * you can't see their block, and the server refuses the follow). Each result says whether `me` follows them, so
 * its Follow button starts in the right state. Returns [] for a query that is too short.
 */
export async function searchLifters(client: SupabaseClient, me: string, query: string): Promise<LifterResult[]> {
  if (query.trim().length < MIN_SEARCH_LENGTH) return [];
  const term = sanitizeSearchTerm(query);
  if (term.length === 0) return [];

  const blocked = await client.from('blocks').select('blocked_id').eq('blocker_id', me);
  throwIfError(blocked.error, 'Search failed');
  const blockedIds = ((blocked.data ?? []) as { blocked_id: string }[]).map((r) => r.blocked_id);

  // People I blocked are left out by the query itself, so they never use up one of the
  // SEARCH_LIMIT places. Ids are uuids from the server, so the list needs no escaping.
  let request = client.from('profiles').select('id,username,display_name').or(searchFilter(term)).neq('id', me);
  if (blockedIds.length > 0) request = request.not('id', 'in', `(${blockedIds.join(',')})`);
  const found = await request.order('username', { ascending: true }).limit(SEARCH_LIMIT);
  throwIfError(found.error, 'Search failed');
  const people = (found.data ?? []) as { id: string; username: string | null; display_name: string | null }[];
  if (people.length === 0) return [];

  const follows = await client
    .from('follows')
    .select('followee_id')
    .eq('follower_id', me)
    .in(
      'followee_id',
      people.map((p) => p.id),
    );
  throwIfError(follows.error, 'Search failed');
  const followingIds = new Set(((follows.data ?? []) as { followee_id: string }[]).map((r) => r.followee_id));

  return people.map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name,
    following: followingIds.has(p.id),
  }));
}

/**
 * `me` follows `userId`. Already following counts as success (pressing twice is harmless). A
 * refusal from the server — a block in either direction — comes back as `FOLLOW_REFUSED`,
 * which tells a blocked lifter nothing they didn't already know.
 */
export async function follow(client: SupabaseClient, me: string, userId: string): Promise<FollowResult> {
  try {
    const { error } = await client.from('follows').insert({ follower_id: me, followee_id: userId });
    if (!error) return { ok: true };
    const code = (error as { code?: string }).code;
    if (code === '23505') return { ok: true };
    if (code === '42501') return { ok: false, message: FOLLOW_REFUSED };
    return { ok: false, message: FOLLOW_FAILED };
  } catch {
    return { ok: false, message: FOLLOW_FAILED };
  }
}

/** `me` stops following `userId`. Not following already is no error. */
export async function unfollow(client: SupabaseClient, me: string, userId: string): Promise<FollowResult> {
  try {
    const { error } = await client.from('follows').delete().eq('follower_id', me).eq('followee_id', userId);
    return error ? { ok: false, message: FOLLOW_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: FOLLOW_FAILED };
  }
}
