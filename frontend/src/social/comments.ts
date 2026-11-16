/**
 * Reading and writing a post's comments (SOC-5, B23) — and, since B41, a Marketplace program's
 * (MKT-3), through the same code with only the table and key column swapped.
 *
 * Why this exists: the comments screen needs a post's comments (oldest first, each with who wrote
 * it) and a way to add one. Like the feed, comments are read straight from the server and never
 * stored on the phone; writing one needs a connection (plan decision G1 — you comment on a post
 * you are looking at, and posts are only on screen when the feed loaded).
 *
 * Who may read or write which comments is decided by the server's security rules. On posts: you
 * see the comments of exactly the posts you can see, and comment only on those, only as yourself.
 * On programs: you see the comments of a program you can see, and comment only on a published
 * one, only as yourself. Either way, comments by a lifter blocked either way or muted by you don't
 * arrive (B27), and your own always do.
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

/** The comment's author, nested in (PostgREST "embedding") — the same for post and program comments. */
const COMMENT_AUTHOR_EMBED = 'author:profiles(id,username,display_name)';

/** The columns a post comment read asks for, with the author nested in. */
export const COMMENT_SELECT = `id,post_id,user_id,body,created_at,${COMMENT_AUTHOR_EMBED}`;

/**
 * A comment exactly as the server sends it for `COMMENT_SELECT` (the one place the untyped reply
 * is described). A program comment (B41) carries `program_id` instead of `post_id`; neither is
 * read past this seam.
 */
export interface RawComment {
  id: string;
  post_id?: string;
  program_id?: string;
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
 * Where one kind of comment lives on the server: its table, the column naming what it is on, and
 * the columns asked for. Post comments and (B41) program comments share the code below; only
 * this differs. The author embed and every rule are the same.
 */
interface CommentTarget {
  table: 'comments' | 'program_comments';
  key: 'post_id' | 'program_id';
  select: string;
}

const POST_COMMENTS: CommentTarget = { table: 'comments', key: 'post_id', select: COMMENT_SELECT };

/** (B41) The columns asked for on a program comment — `COMMENT_SELECT` with the program's key. */
export const PROGRAM_COMMENT_SELECT = `id,program_id,user_id,body,created_at,${COMMENT_AUTHOR_EMBED}`;

const PROGRAM_COMMENTS: CommentTarget = { table: 'program_comments', key: 'program_id', select: PROGRAM_COMMENT_SELECT };

/** The one "load a conversation" implementation: oldest first, id as the tiebreak, capped. Throws on failure. */
async function loadFrom(client: SupabaseClient, target: CommentTarget, id: string): Promise<CommentsPage> {
  const { data, error } = await client
    .from(target.table)
    .select(target.select)
    .eq(target.key, id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(COMMENTS_LIMIT);
  throwIfError(error, 'Loading the comments failed');
  // The one cast from the untyped reply, at the seam; everything past here is typed.
  const raw = (data ?? []) as unknown as RawComment[];
  return { comments: raw.map(toPostComment), more: raw.length === COMMENTS_LIMIT };
}

/** The one "add a comment" implementation: checks the text first, then inserts and returns the saved row. Throws on failure. */
async function addTo(client: SupabaseClient, target: CommentTarget, me: string, id: string, body: string): Promise<PostComment> {
  const problem = commentBodyError(body);
  if (problem) throw new Error(problem);
  const { data, error } = await client
    .from(target.table)
    .insert({ [target.key]: id, user_id: me, body })
    .select(target.select)
    .single();
  throwIfError(error, 'Posting the comment failed');
  if (!data) throw new Error('Posting the comment failed: the server sent nothing back');
  return toPostComment(data as unknown as RawComment);
}

/**
 * Loads a post's comments, oldest first (a conversation reads top to bottom), the id breaking
 * ties so the order never wobbles. Throws when the request fails (e.g. no connection).
 */
export function loadComments(client: SupabaseClient, postId: string): Promise<CommentsPage> {
  return loadFrom(client, POST_COMMENTS, postId);
}

/**
 * Adds the lifter's comment to a post and returns it as the server saved it (so the screen shows
 * the real row — its id, its time — not a guess).
 * Inputs: the client, the lifter's id (`me`), the post, and the text as typed.
 * Text that breaks the rules (blank, too long) is refused here with the rule's own sentence,
 * without sending anything. Throws on a refusal or a failed request.
 */
export function addComment(client: SupabaseClient, me: string, postId: string, body: string): Promise<PostComment> {
  return addTo(client, POST_COMMENTS, me, postId, body);
}

/**
 * (B41, MKT-3) Loads a Marketplace program's comments — the same order, cap and "more" flag as
 * a post's. Whoever may see the program may read them (the server's rule). Throws on failure.
 */
export function loadProgramComments(client: SupabaseClient, programId: string): Promise<CommentsPage> {
  return loadFrom(client, PROGRAM_COMMENTS, programId);
}

/**
 * (B41, MKT-3) Adds the lifter's comment to a program and returns it as saved — the same text
 * rules as a post comment (`commentLimits.ts`). The server takes comments only on a published
 * program. Throws on a refusal or a failed request.
 */
export function addProgramComment(client: SupabaseClient, me: string, programId: string, body: string): Promise<PostComment> {
  return addTo(client, PROGRAM_COMMENTS, me, programId, body);
}
