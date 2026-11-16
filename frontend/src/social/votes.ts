/**
 * Voting on posts (SOC-4, B23) and, since B41, on Marketplace programs (MKT-3): an upvote (+1)
 * or a downvote (−1), at most one per lifter per post (or program), and the net score shown.
 * Both kinds share one implementation; only the server table and its key column differ.
 *
 * Why this exists: the card needs three things — send a vote, take one back, and move the shown
 * score the moment an arrow is tapped (before the server answers). The server is the only home
 * of the real tally (the `post_scores` view for posts, `program_scores` for programs); this file
 * never adds votes up. It only knows how one lifter's change of vote moves a number already on
 * screen (`voteDelta`), and the next load replaces that number with the server's.
 *
 * Votes are online-only (plan decision G1): a vote is cast on a feed card or a program page, and
 * both only exist with a connection, so there is nothing to queue.
 *
 * Who may vote on what is NOT decided here. For posts the server refuses a vote on a post the
 * lifter can't see, a vote as someone else, and — the Physique Check rule — any downvote on a
 * post whose flair takes upvotes only. For programs it refuses a vote as someone else and any
 * vote on a program that isn't published. This file just turns those refusals into words.
 *
 * The Supabase client is passed in (never fetched here), so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** A lifter's vote on a post or program: up (+1) or down (−1). "No vote" is spelled `null` where it can occur. */
export type VoteValue = 1 | -1;

/** Why a vote didn't go through, and the sentence the card shows for it. */
export type VoteRefusal = 'upvotes-only' | 'failed';

/** The words for each refusal. */
export const VOTE_REFUSAL_MESSAGES: Record<VoteRefusal, string> = {
  'upvotes-only': 'This post takes upvotes only.',
  failed: 'Your vote didn’t go through. Check your connection and try again.',
};

/** A vote request's answer: done, or refused with the reason. */
export type VoteResult = { ok: true } | { ok: false; reason: VoteRefusal };

/**
 * The error code the server's upvote-only trigger raises (`raise exception` = SQLSTATE P0001).
 * No other rule on the votes table raises it, so it always means "this post takes upvotes only".
 */
export const UPVOTES_ONLY_CODE = 'P0001';

/**
 * Where one kind of vote lives on the server: its table, the column naming what was voted on,
 * and whether that table has the upvote-only trigger (so a P0001 error means "upvotes only").
 * Posts have the trigger; programs (B41) have no flair and no such rule, so every refusal there
 * is plainly 'failed' — P0001 is never given a meaning it doesn't have.
 */
interface VoteTarget {
  table: 'votes' | 'program_votes';
  key: 'post_id' | 'program_id';
  upvotesOnlyRule: boolean;
}

const POST_VOTES: VoteTarget = { table: 'votes', key: 'post_id', upvotesOnlyRule: true };
const PROGRAM_VOTES: VoteTarget = { table: 'program_votes', key: 'program_id', upvotesOnlyRule: false };

/**
 * Sorts a request's answer for this kind of vote: done, the upvote-only rule (posts only), or
 * anything else (no signal, the post or program gone or not open to votes) as 'failed'.
 */
function refusalFor(target: VoteTarget, error: { code?: string } | null): VoteResult {
  if (!error) return { ok: true };
  const upvotesOnly = target.upvotesOnlyRule && error.code === UPVOTES_ONLY_CODE;
  return { ok: false, reason: upvotesOnly ? 'upvotes-only' : 'failed' };
}

/**
 * The one "cast or change a vote" implementation. It "upserts" on the (thing, lifter) pair: a
 * first vote adds the row, a changed mind (up → down) rewrites it, and a retried tap lands on the
 * same row — so a lifter can never count twice. Never throws.
 */
async function upsertVote(client: SupabaseClient, target: VoteTarget, me: string, id: string, value: VoteValue): Promise<VoteResult> {
  try {
    const { error } = await client
      .from(target.table)
      .upsert({ [target.key]: id, user_id: me, value }, { onConflict: `${target.key},user_id` });
    return refusalFor(target, error);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** The one "take a vote back" implementation: deletes the lifter's own row on that thing. Never throws. */
async function deleteVote(client: SupabaseClient, target: VoteTarget, me: string, id: string): Promise<VoteResult> {
  try {
    const { error } = await client.from(target.table).delete().eq(target.key, id).eq('user_id', me);
    return refusalFor(target, error);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Casts (or changes) the lifter's vote on a post.
 * Inputs: the client, the lifter's id (`me`), the post, and +1 or −1.
 * Output: done, or the reason it was refused (including "this post takes upvotes only"). Never throws.
 */
export function castVote(client: SupabaseClient, me: string, postId: string, value: VoteValue): Promise<VoteResult> {
  return upsertVote(client, POST_VOTES, me, postId, value);
}

/**
 * Takes the lifter's vote off a post (tapping the lit arrow again).
 * Output: done, or 'failed'. Never throws.
 */
export function clearVote(client: SupabaseClient, me: string, postId: string): Promise<VoteResult> {
  return deleteVote(client, POST_VOTES, me, postId);
}

/**
 * (B41, MKT-3) Casts or changes the lifter's vote on a Marketplace program — exactly as on a
 * post: one row per (program, lifter), a changed mind rewrites it. The server takes votes only on
 * a published program and only as the lifter themselves; any refusal comes back as 'failed'.
 * Never throws.
 */
export function castProgramVote(client: SupabaseClient, me: string, programId: string, value: VoteValue): Promise<VoteResult> {
  return upsertVote(client, PROGRAM_VOTES, me, programId, value);
}

/** (B41) Takes the lifter's vote off a program (tapping the lit arrow again). Output: done, or 'failed'. Never throws. */
export function clearProgramVote(client: SupabaseClient, me: string, programId: string): Promise<VoteResult> {
  return deleteVote(client, PROGRAM_VOTES, me, programId);
}

/**
 * How much the shown score moves when one lifter's vote changes from `from` to `to` (null = no
 * vote). Examples: none → up is +1; up → down is −2 (the up comes off and a down goes on);
 * down → none is +1. Used to move the score on screen the instant an arrow is tapped.
 */
export function voteDelta(from: VoteValue | null, to: VoteValue | null): number {
  return (to ?? 0) - (from ?? 0);
}

/**
 * What tapping an arrow means given the lifter's current vote: tapping the arrow that is already
 * lit takes the vote off (null); tapping the other one (or either, with no vote) sets it.
 */
export function nextVote(current: VoteValue | null, tapped: VoteValue): VoteValue | null {
  return current === tapped ? null : tapped;
}
