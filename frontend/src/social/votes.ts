/**
 * Voting on posts (SOC-4, B23): an upvote (+1) or a downvote (−1), at most one per lifter per
 * post, and the net score the feed card shows.
 *
 * Why this exists: the card needs three things — send a vote, take one back, and move the shown
 * score the moment an arrow is tapped (before the server answers). The server is the only home
 * of the real tally (the `post_scores` view); this file never adds votes up. It only knows how
 * one lifter's change of vote moves a number already on screen (`voteDelta`), and the next feed
 * load replaces that number with the server's.
 *
 * Votes are online-only (plan decision G1): a vote is cast on a feed card, and the feed only
 * exists with a connection, so there is nothing to queue.
 *
 * Who may vote on what is NOT decided here: the server refuses a vote on a post the lifter can't
 * see, a vote as someone else, and — the Physique Check rule — any downvote on a post whose
 * flair takes upvotes only. This file just turns those refusals into words.
 *
 * The Supabase client is passed in (never fetched here), so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** A lifter's vote on a post: up (+1) or down (−1). "No vote" is spelled `null` where it can occur. */
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

/** Sorts a failed request into a refusal: the upvote-only rule, or anything else (no signal, post gone). */
function refusal(error: { code?: string } | null): VoteResult {
  if (!error) return { ok: true };
  return { ok: false, reason: error.code === UPVOTES_ONLY_CODE ? 'upvotes-only' : 'failed' };
}

/**
 * Casts (or changes) the lifter's vote on a post.
 * Inputs: the client, the lifter's id (`me`), the post, and +1 or −1.
 * It "upserts" on the (post, lifter) pair: a first vote adds the row, a changed mind (up → down)
 * rewrites it, and a retried tap lands on the same row — so a lifter can never count twice.
 * Output: done, or the reason it was refused. Never throws.
 */
export async function castVote(client: SupabaseClient, me: string, postId: string, value: VoteValue): Promise<VoteResult> {
  try {
    const { error } = await client
      .from('votes')
      .upsert({ post_id: postId, user_id: me, value }, { onConflict: 'post_id,user_id' });
    return refusal(error);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Takes the lifter's vote off a post (tapping the lit arrow again).
 * Output: done, or 'failed'. Never throws.
 */
export async function clearVote(client: SupabaseClient, me: string, postId: string): Promise<VoteResult> {
  try {
    const { error } = await client.from('votes').delete().eq('post_id', postId).eq('user_id', me);
    return refusal(error);
  } catch {
    return { ok: false, reason: 'failed' };
  }
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
