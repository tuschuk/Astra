/**
 * Reading and writing a post's comments (SOC-5, B23).
 *
 * Why this exists: the comments screen needs a post's comments (oldest first, each with who wrote
 * it) and a way to add one. Like the feed, comments are read straight from the server and never
 * stored on the phone; writing one needs a connection (plan decision G1 — you comment on a post
 * you are looking at, and posts are only on screen when the feed loaded).
 *
 * Who may read or write which comments is decided by the server's security rules: you can see the
 * comments of exactly the posts you can see, and comment only on those, only as yourself.
 *
 * The Supabase client is passed in (never fetched here), so tests hand it a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { throwIfError } from '@/lib/throwIfError';

import { commentBodyError } from './commentLimits';
import type { PersonName } from './names';

/**
 * The most comments one load brings back. A post at launch scale has tens; when exactly this many
 * arrive the screen says more exist (paging is a recorded follow-up, see docs/DEFERRED.md).
 */
export const COMMENTS_LIMIT = 200;

/** The columns asked for, with the author nested in (PostgREST "embedding"). */
export const COMMENT_SELECT = 'id,post_id,user_id,body,created_at,author:profiles(id,username,display_name)';

/** A comment exactly as the server sends it for `COMMENT_SELECT` (the one place the untyped reply is described). */
export interface RawComment {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author: { id: string; username: string | null; display_name: string | null } | null;
}

/** One comment, shaped for the screen. */
export interface PostComment {
  id: string;
  body: string;
  createdAt: string;
  author: PersonName & { id: string };
}

/** Turns one server comment into the screen's shape; a missing author is filled in so nothing crashes. */
export function toPostComment(raw: RawComment): PostComment {
  return {
    id: raw.id,
    body: raw.body,
    createdAt: raw.created_at,
    author: {
      id: raw.author?.id ?? raw.user_id,
      username: raw.author?.username ?? null,
      displayName: raw.author?.display_name ?? null,
    },
  };
}

/** A load's answer: the comments in conversation order, and whether the cap cut some off. */
export interface CommentsPage {
  comments: PostComment[];
  /** True when exactly `COMMENTS_LIMIT` arrived — there may be more than are shown. */
  more: boolean;
}

/**
 * Loads a post's comments, oldest first (a conversation reads top to bottom), the id breaking
 * ties so the order never wobbles. Throws when the request fails (e.g. no connection).
 */
export async function loadComments(client: SupabaseClient, postId: string): Promise<CommentsPage> {
  const { data, error } = await client
    .from('comments')
    .select(COMMENT_SELECT)
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(COMMENTS_LIMIT);
  throwIfError(error, 'Loading the comments failed');
  // The one cast from the untyped reply, at the seam; everything past here is typed.
  const raw = (data ?? []) as unknown as RawComment[];
  return { comments: raw.map(toPostComment), more: raw.length === COMMENTS_LIMIT };
}

/**
 * Adds the lifter's comment to a post and returns it as the server saved it (so the screen shows
 * the real row — its id, its time — not a guess).
 * Inputs: the client, the lifter's id (`me`), the post, and the text as typed.
 * Text that breaks the rules (blank, too long) is refused here with the rule's own sentence,
 * without sending anything. Throws on a refusal or a failed request.
 */
export async function addComment(client: SupabaseClient, me: string, postId: string, body: string): Promise<PostComment> {
  const problem = commentBodyError(body);
  if (problem) throw new Error(problem);
  const { data, error } = await client
    .from('comments')
    .insert({ post_id: postId, user_id: me, body })
    .select(COMMENT_SELECT)
    .single();
  throwIfError(error, 'Posting the comment failed');
  if (!data) throw new Error('Posting the comment failed: the server sent nothing back');
  return toPostComment(data as unknown as RawComment);
}
