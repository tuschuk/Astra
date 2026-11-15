/**
 * Re-sharing a post (SOC-6, B28): passing another lifter's post on to your own followers. The
 * re-share is a post of its own (server `posts.kind = 'reshare'`) that points at the original
 * through `shared_post_id`; the feed card shows the original inside it.
 *
 * Why this exists: the feed card's Re-share button needs one call that sends the re-share and
 * turns the server's answer into a sentence — done, already re-shared, or didn't go through.
 *
 * Online-only (plan G2): a re-share is tapped on a feed card, and the feed only exists with a
 * connection, so there is nothing to queue (the votes and comments precedent).
 *
 * What the server decides, not this file: that the original exists and the lifter may see it,
 * that it is not the lifter's own post, that it is not itself a re-share (chains are refused —
 * the card always re-shares the original), one re-share per lifter per post, and the flair (the
 * server copies the original's onto the re-share, so a Physique Check re-share stays
 * upvote-only). Who sees the re-share is the server's too: exactly the people who may see both
 * the re-share and the original.
 *
 * The Supabase client is passed in (never fetched here), so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { newUuid } from '@/lib/ids';

import type { FeedPost } from './feed';

/** Why a re-share didn't go through. */
export type ReshareRefusal = 'already-reshared' | 'failed';

/** The sentence the card shows after a re-share attempt, by outcome. */
export const RESHARE_MESSAGES: Record<ReshareRefusal | 'done', string> = {
  done: 'Re-shared to your followers.',
  'already-reshared': 'You’ve already re-shared this post.',
  failed: 'The re-share didn’t go through. Check your connection and try again.',
};

/** A re-share's answer: done (with the new post's id), or refused with the reason. */
export type ReshareResult = { ok: true; id: string } | { ok: false; reason: ReshareRefusal };

/** Postgres's "that unique key is taken" code: here, one re-share per lifter per post. */
export const ALREADY_RESHARED_CODE = '23505';

/**
 * The post a Re-share tap actually passes on: the post itself, or — when the card is already a
 * re-share — its original (plan G4: re-sharing a re-share re-shares the original, never a chain).
 * Returns its id and flair id (the flair is sent so the row is honest; the server overwrites it
 * with the original's anyway).
 */
export function reshareTarget(post: FeedPost): { id: string; flairId: string } {
  const source = post.kind === 'reshare' ? post.original : post;
  return { id: source.id, flairId: source.flair.id };
}

/**
 * Re-shares a post as the lifter `me`.
 * Inputs: the client, the lifter's id, the card's post (a re-share card re-shares its original),
 * and "now" (tests pin it).
 * It inserts one new post row: a fresh id, kind 'reshare', the original's id, its flair, and a
 * public audience (plan G7: a re-share carries none of the resharer's own content — the
 * original's rules still decide who sees it; the owner can tighten it with the visibility chip).
 * Output: done with the new id, 'already-reshared', or 'failed' (no signal, the post is gone,
 * or the server refused it). Never throws.
 */
export async function resharePost(
  client: SupabaseClient,
  me: string,
  post: FeedPost,
  now: Date = new Date(),
): Promise<ReshareResult> {
  const target = reshareTarget(post);
  const id = newUuid();
  try {
    const { error } = await client.from('posts').insert({
      id,
      user_id: me,
      kind: 'reshare',
      shared_post_id: target.id,
      flair_id: target.flairId,
      visibility: 'public',
      created_at: now.toISOString(),
    });
    if (!error) return { ok: true, id };
    return { ok: false, reason: error.code === ALREADY_RESHARED_CODE ? 'already-reshared' : 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
