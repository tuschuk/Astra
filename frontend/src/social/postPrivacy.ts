/**
 * Changing who can see a post after it was made (B26, YOU-5): Public (anyone on Astra),
 * Followers (only people who follow the lifter), or Only you (private).
 *
 * Who may see what is NOT decided here. The server's row-level security reads each post's
 * visibility on every request (`private.workout_visible`), and the photo bucket's read rule
 * follows the same post row — so once this update lands, a private post and its photo are gone
 * for everyone else through the API, not just hidden on screen. This file only asks for the
 * change and reports the answer.
 *
 * A workout post and its workout move together. The server does that itself, in the same
 * transaction, with a trigger (`sync_workout_visibility`, B26 migration): a post made private
 * must not leave its session readable on the lifter's profile History. Afterwards this file
 * brings the phone's own copies into line (see `mirrorLocally`).
 *
 * Online-only, like votes, comments and follows: the control lives on feed and profile cards,
 * which are read from the server and need a connection anyway. There is nothing to queue.
 *
 * The Supabase client and the phone's database are passed in, so tests hand them fakes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { notifyLocalWrite, type WorkoutVisibility } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';

import type { FeedPost } from './feed';

/**
 * The words for each visibility, in one place so the post card, Settings and the Share a photo
 * screen all say the same thing:
 *   - `label` — the short name on a chip ("Only you");
 *   - `meaning` — the sentence that says what it means for a post.
 */
export const VISIBILITY_WORDS: Record<WorkoutVisibility, { label: string; meaning: string }> = {
  public: { label: 'Public', meaning: 'Anyone on Astra can see this post' },
  followers: { label: 'Followers', meaning: 'Your followers can see this post' },
  private: { label: 'Only you', meaning: 'Only you can see this post' },
};

/** The three visibilities in the order every chooser lists them: the most private first. */
export const VISIBILITY_ORDER: readonly WorkoutVisibility[] = ['private', 'followers', 'public'];

/** Why a visibility change didn't go through. */
export type PostVisibilityRefusal = 'not-changed' | 'failed';

/** The sentence a card shows for each refusal. */
export const POST_VISIBILITY_REFUSAL_MESSAGES: Record<PostVisibilityRefusal, string> = {
  'not-changed': 'This post can’t be changed right now.',
  failed: 'Couldn’t change who can see this post. Check your connection and try again.',
};

/** A visibility change's answer: done, or refused with the reason. */
export type PostVisibilityResult = { ok: true } | { ok: false; reason: PostVisibilityRefusal };

/** The post being changed: its id and, for a workout post, its workout's id. */
export interface PostVisibilityTarget {
  id: string;
  /** The shared workout's id, or null for a photo post (which has no workout). */
  workoutId: string | null;
}

/** The change target for a post as the feed and profile screens hold it. */
export function visibilityTargetOf(post: FeedPost): PostVisibilityTarget {
  return { id: post.id, workoutId: post.kind === 'workout' ? post.workout.id : null };
}

/**
 * A screen's list of posts with post `postId` now shown as `next` — used after a change the
 * server accepted, so a card that scrolls away and is rebuilt from the list shows the new
 * audience, not the one the list was loaded with. Returns a new list; other posts are untouched.
 */
export function withPostVisibility(posts: FeedPost[], postId: string, next: WorkoutVisibility): FeedPost[] {
  return posts.map((p) => (p.id === postId ? { ...p, visibility: next } : p));
}

/**
 * Sets the visibility of the lifter's own post.
 * Inputs: the client; the phone's database (null if it couldn't be opened — the server change
 * still happens); the lifter's id (`me`); the post; and the new visibility.
 * Output: done, `not-changed` when the server changed no row (the post is gone, or isn't the
 * lifter's — row-level security refuses anyone else's post), or `failed` (no connection, or any
 * other error). Never throws.
 *
 * The `user_id = me` filter is a belt-and-braces narrowing, not the security: the server's update
 * rule is what stops one lifter changing another's post.
 */
export async function setPostVisibility(
  client: SupabaseClient,
  db: SqlDriver | null,
  me: string,
  post: PostVisibilityTarget,
  next: WorkoutVisibility,
): Promise<PostVisibilityResult> {
  try {
    const { data, error } = await client
      .from('posts')
      .update({ visibility: next })
      .eq('id', post.id)
      .eq('user_id', me)
      .select('id');
    if (error) return { ok: false, reason: 'failed' };
    if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: 'not-changed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (db) {
    try {
      await mirrorLocally(db, me, post, next);
      // Screens that read these tables from the phone (the lifter's own History) redraw.
      notifyLocalWrite(db, post.workoutId ? ['posts', 'workouts'] : ['posts']);
    } catch (error) {
      // The server already holds the truth; the next download brings the phone into line.
      console.warn('Post privacy: the phone’s copy could not be updated', error);
    }
  }
  return { ok: true };
}

/**
 * Brings the phone's copies in step with a visibility change the server has already accepted:
 * the post row (if this phone made the post) and, for a workout post, the workout row.
 *
 * The workout row is the one that matters. A later edit of that workout on this phone (B14)
 * uploads the whole row; without this, it would send the old visibility back up and quietly undo
 * the lifter's choice. No upload lines are added — the server already has the change.
 * Both updates run in one transaction and only touch the lifter's own rows.
 */
async function mirrorLocally(db: SqlDriver, me: string, post: PostVisibilityTarget, next: WorkoutVisibility): Promise<void> {
  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync('update posts set visibility = ? where id = ? and user_id = ?', [next, post.id, me]);
    if (post.workoutId) {
      await tx.runAsync('update workouts set visibility = ? where id = ? and user_id = ?', [next, post.workoutId, me]);
    }
  });
}
