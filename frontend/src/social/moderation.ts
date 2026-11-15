/**
 * Safety controls (SOC-8, B27): report a post or comment, mute a lifter, block a lifter.
 *
 * Why this exists: every social app needs a way to say "this breaks the rules" (a report, which
 * lands in the founder's queue) and "I don't want this person in my space" (mute or block).
 *   - **Report** — files one report about a post or comment, with a reason from the content
 *     policy (docs/CONTENT_POLICY.md) and optional details. The server works out whose content it
 *     is from the content itself, so a report can't be aimed at the wrong person.
 *   - **Mute** — the muted lifter's posts, workouts, PRs, comments and votes disappear for you,
 *     everywhere. They are never told; you keep following them; you can unmute any time.
 *   - **Block** — like mute, but both ways: neither of you sees the other, and any follows between
 *     you are removed (by the server, in the same step). Later, a block also cuts messages.
 *
 * What disappears is decided entirely by the server's row-level security — this file only writes
 * or deletes the one row that records the choice. All of it is online-only: these actions are
 * offered on content and profiles that needed a connection to load.
 *
 * The Supabase client is passed in (never fetched here), so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { throwIfError } from '@/lib/throwIfError';

/**
 * The reasons a lifter can give for a report, in the order the report sheet lists them.
 * Mirrors the `reports.reason` CHECK in `…_moderation.sql` and the six sections of
 * docs/CONTENT_POLICY.md — change the three together.
 */
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam', meaning: 'Ads, scams, or the same thing posted over and over.' },
  { value: 'harassment', label: 'Harassment', meaning: 'Bullying, threats, hate, or targeting someone.' },
  { value: 'nudity', label: 'Nudity or sexual content', meaning: 'Explicit or sexual images or words.' },
  { value: 'not-training', label: 'Not about training', meaning: 'Nothing to do with lifting or the gym.' },
  { value: 'impersonation', label: 'Impersonation', meaning: 'Pretending to be someone else.' },
  { value: 'other', label: 'Something else', meaning: 'Illegal, dangerous, or otherwise against the rules.' },
] as const;

/** One report reason's slug, as stored on the server. */
export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

/** The longest a report's optional details can be — the CHECK on `reports.details`. */
export const REPORT_DETAILS_MAX_CHARS = 500;

/** The details counter appears this close to the limit (the comment box's rule). */
export const REPORT_COUNTER_FROM = REPORT_DETAILS_MAX_CHARS - 100;

/** What was reported. */
export type ReportTarget = { kind: 'post' | 'comment'; id: string };

/** How a report went. */
export type ReportResult = { ok: true } | { ok: false; message: string };

/** The thank-you line after a report (also shown for a second report of the same thing). */
export const REPORT_THANKS = 'Thanks — the report is in. We review every one against the content policy.';

/** Shown when the report couldn't be filed: no connection, or the content is gone / no longer visible. */
export const REPORT_FAILED = 'That report didn’t go through. Check your connection and try again.';

/** Shown when the details are over the limit (the sheet's Submit is off then, so this is a backstop). */
export const REPORT_TOO_LONG = `Keep the details to ${REPORT_DETAILS_MAX_CHARS} characters.`;

/** How a mute / block change went. */
export type SafetyResult = { ok: true } | { ok: false; message: string };

/** Shown when a mute or block change didn't get through. */
export const SAFETY_FAILED = 'That didn’t go through. Check your connection and try again.';

/** Postgres "already exists" (a unique key hit): a second tap of the same action. */
const UNIQUE_VIOLATION = '23505';

/** The details exactly as they'll be sent: trimmed, and null when nothing is left. */
export function cleanDetails(details: string): string | null {
  const trimmed = details.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Is this details text too long? Counted in characters as the server counts them (an emoji is
 * one), not in UTF-16 units — the comment box's rule.
 */
export function detailsTooLong(details: string): boolean {
  const cleaned = cleanDetails(details);
  return cleaned != null && [...cleaned].length > REPORT_DETAILS_MAX_CHARS;
}

/**
 * Files a report by `me` about a post or comment. The server fills in whose content it is.
 * Reporting the same thing twice counts as success (the first report already stands). Any other
 * refusal — no connection, the content gone or no longer visible to `me` — is one calm sentence.
 * Never throws.
 */
export async function report(
  client: SupabaseClient,
  me: string,
  target: ReportTarget,
  reason: ReportReason,
  details: string,
): Promise<ReportResult> {
  if (detailsTooLong(details)) return { ok: false, message: REPORT_TOO_LONG };
  try {
    const { error } = await client.from('reports').insert({
      reporter_id: me,
      target_kind: target.kind,
      target_id: target.id,
      reason,
      details: cleanDetails(details),
    });
    if (!error || (error as { code?: string }).code === UNIQUE_VIOLATION) return { ok: true };
    return { ok: false, message: REPORT_FAILED };
  } catch {
    return { ok: false, message: REPORT_FAILED };
  }
}

/**
 * Reports a post — the post card's ⋯. `me` is null when there's no session (nothing is sent).
 * The one spelling the Home feed and the profile both use.
 */
export function reportPost(
  client: SupabaseClient,
  me: string | null,
  postId: string,
  reason: ReportReason,
  details: string,
): Promise<ReportResult> {
  if (!me) return Promise.resolve({ ok: false, message: REPORT_FAILED });
  return report(client, me, { kind: 'post', id: postId }, reason, details);
}

/** Reports a comment — the comment row's ⋯. Same rules as `reportPost`. */
export function reportComment(
  client: SupabaseClient,
  me: string | null,
  commentId: string,
  reason: ReportReason,
  details: string,
): Promise<ReportResult> {
  if (!me) return Promise.resolve({ ok: false, message: REPORT_FAILED });
  return report(client, me, { kind: 'comment', id: commentId }, reason, details);
}

/** Adds a row as `me` to `mutes` or `blocks`; a re-tap (already there) is success. Never throws. */
async function addRow(client: SupabaseClient, table: 'mutes' | 'blocks', row: Record<string, string>): Promise<SafetyResult> {
  try {
    const { error } = await client.from(table).insert(row);
    if (!error || (error as { code?: string }).code === UNIQUE_VIOLATION) return { ok: true };
    return { ok: false, message: SAFETY_FAILED };
  } catch {
    return { ok: false, message: SAFETY_FAILED };
  }
}

/** Removes `me`'s row from `mutes` or `blocks`; not there already is no error. Never throws. */
async function removeRow(
  client: SupabaseClient,
  table: 'mutes' | 'blocks',
  mine: [string, string],
  theirs: [string, string],
): Promise<SafetyResult> {
  try {
    const { error } = await client.from(table).delete().eq(mine[0], mine[1]).eq(theirs[0], theirs[1]);
    return error ? { ok: false, message: SAFETY_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: SAFETY_FAILED };
  }
}

/** `me` mutes `userId`: their content disappears for `me`; they aren't told and follows stay. */
export function muteUser(client: SupabaseClient, me: string, userId: string): Promise<SafetyResult> {
  return addRow(client, 'mutes', { muter_id: me, muted_id: userId });
}

/** `me` unmutes `userId`: everything that was hidden shows again on the next load. */
export function unmuteUser(client: SupabaseClient, me: string, userId: string): Promise<SafetyResult> {
  return removeRow(client, 'mutes', ['muter_id', me], ['muted_id', userId]);
}

/** `me` blocks `userId`: neither sees the other; the server removes follows both ways. */
export function blockUser(client: SupabaseClient, me: string, userId: string): Promise<SafetyResult> {
  return addRow(client, 'blocks', { blocker_id: me, blocked_id: userId });
}

/** `me` unblocks `userId`. Follows removed by the block don't come back — following again is a choice. */
export function unblockUser(client: SupabaseClient, me: string, userId: string): Promise<SafetyResult> {
  return removeRow(client, 'blocks', ['blocker_id', me], ['blocked_id', userId]);
}

/** Whether `me` is blocking and/or muting a lifter — the profile's button states. */
export interface Relation {
  blocking: boolean;
  muting: boolean;
}

/**
 * Reads whether `me` has blocked or muted `profileId` (only `me`'s own rows are readable, which
 * is exactly what's asked). Throws when the request fails, like the profile's other loaders.
 */
export async function relationTo(client: SupabaseClient, me: string, profileId: string): Promise<Relation> {
  const [blocks, mutes] = await Promise.all([
    client.from('blocks').select('blocked_id').eq('blocker_id', me).eq('blocked_id', profileId),
    client.from('mutes').select('muted_id').eq('muter_id', me).eq('muted_id', profileId),
  ]);
  throwIfError(blocks.error, 'Reading blocks failed');
  throwIfError(mutes.error, 'Reading mutes failed');
  return { blocking: (blocks.data ?? []).length > 0, muting: (mutes.data ?? []).length > 0 };
}
