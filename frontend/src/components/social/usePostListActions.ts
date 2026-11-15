/**
 * usePostListActions — what every list of post cards does when the lifter taps a card's buttons.
 *
 * Why it exists: Home, a profile's Posts tab and (B36) a team's feed each show the same post
 * cards, and each card's buttons need the same wiring: vote (B23), open comments, open the
 * author's profile (B25), change who can see your own post (B26), report someone else's (B27),
 * re-share it or open your workout's share card (B28). The team feed would have been the third
 * copy of that block, so it lives here once and all three lists use it.
 *
 * Input: the Supabase client, the phone's database (for the privacy change, which also updates
 * the phone's own copy), the signed-in lifter's id, and `onVisibilityChanged` — what the list
 * does after a successful privacy change (each list updates its own copy of the post, so a card
 * rebuilt after scrolling shows the new audience).
 *
 * Output: one function per card button, ready to hand to `PostCard`. With nobody signed in each
 * write quietly reports failure. Every write goes straight to the server, where its security
 * rules decide; nothing here decides who may do what.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';

import type { WorkoutVisibility } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import type { FeedPost } from '@/social/feed';
import { reportPost as fileReport, type ReportReason, type ReportResult } from '@/social/moderation';
import { setPostVisibility, visibilityTargetOf, type PostVisibilityResult } from '@/social/postPrivacy';
import { resharePost, type ReshareResult } from '@/social/reshare';
import { castVote, clearVote, type VoteResult, type VoteValue } from '@/social/votes';

export interface PostListActionsInput {
  client: SupabaseClient;
  /** The phone's database, or null while it opens (the privacy change then updates the server only). */
  db: SqlDriver | null;
  /** The signed-in lifter, or null. */
  me: string | null;
  /** Called after a post's audience changed on the server, so the list can update its copy. */
  onVisibilityChanged: (postId: string, next: WorkoutVisibility) => void;
}

export interface PostListActions {
  vote: (postId: string, value: VoteValue | null) => Promise<VoteResult>;
  reportPost: (postId: string, reason: ReportReason, details: string) => Promise<ReportResult>;
  changeVisibility: (post: FeedPost, next: WorkoutVisibility) => Promise<PostVisibilityResult>;
  reshare: (post: FeedPost) => Promise<ReshareResult>;
  shareWorkout: (workoutId: string) => void;
  openComments: (postId: string) => void;
  openProfile: (userId: string) => void;
}

export function usePostListActions({ client, db, me, onVisibilityChanged }: PostListActionsInput): PostListActions {
  const router = useRouter();
  // The latest callback, kept in a ref so the actions below stay the same functions between draws.
  const onChanged = useRef(onVisibilityChanged);
  useEffect(() => {
    onChanged.current = onVisibilityChanged;
  }, [onVisibilityChanged]);

  /** A card's vote: +1 / −1 is cast, null takes the viewer's vote back. */
  const vote = useCallback(
    (postId: string, value: VoteValue | null): Promise<VoteResult> => {
      if (!me) return Promise.resolve({ ok: false, reason: 'failed' });
      return value === null ? clearVote(client, me, postId) : castVote(client, me, postId, value);
    },
    [client, me],
  );

  /** Another lifter's card's ⋯ → report: files it for the founder's moderation queue. */
  const reportPost = useCallback(
    (postId: string, reason: ReportReason, details: string): Promise<ReportResult> =>
      fileReport(client, me, postId, reason, details),
    [client, me],
  );

  /**
   * An own card's "who can see this" choice: the server post (its workout follows there) and the
   * phone's copies, then the list's own copy through `onVisibilityChanged`.
   */
  const changeVisibility = useCallback(
    async (post: FeedPost, next: WorkoutVisibility): Promise<PostVisibilityResult> => {
      if (!me) return { ok: false, reason: 'failed' };
      const result = await setPostVisibility(client, db, me, visibilityTargetOf(post), next);
      if (result.ok) onChanged.current(post.id, next);
      return result;
    },
    [client, db, me],
  );

  /** Another lifter's card's Re-share: one new re-share post, straight to the server. */
  const reshare = useCallback(
    (post: FeedPost): Promise<ReshareResult> =>
      me ? resharePost(client, me, post) : Promise.resolve({ ok: false, reason: 'failed' }),
    [client, me],
  );

  /** An own workout card's Share: the image share card for that workout. */
  const shareWorkout = useCallback(
    (workoutId: string) => router.push({ pathname: '/share-card/[id]', params: { id: workoutId } }),
    [router],
  );

  /** A card's comments button: the post's comments screen. */
  const openComments = useCallback(
    (postId: string) => router.push({ pathname: '/post-comments/[id]', params: { id: postId } }),
    [router],
  );

  /** A card's author header: that lifter's profile. */
  const openProfile = useCallback(
    (userId: string) => router.push({ pathname: '/profile/[id]', params: { id: userId } }),
    [router],
  );

  return { vote, reportPost, changeVisibility, reshare, shareWorkout, openComments, openProfile };
}
