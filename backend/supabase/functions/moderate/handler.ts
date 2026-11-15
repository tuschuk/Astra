/**
 * What the `moderate` server function does with one request (B27, NFR-7 — "content/accounts can
 * be removed"), separated from the Deno wiring in `index.ts` so it can be tested with fakes
 * (tests never touch the real project).
 *
 * Why it exists: Astra's moderation is founder-run at launch. The founder reads the report queue
 * in the Supabase dashboard and, when something breaks the content policy
 * (docs/CONTENT_POLICY.md), removes it by calling this function with their own login. No app
 * user can delete other people's content through the database's security rules — this function
 * is the one door, and it opens only for someone listed in the `moderators` table.
 *
 * The request: `{ "action": "remove-post" | "remove-comment" | "remove-account", "targetId": <uuid> }`.
 * The steps:
 *   1. check the request's shape (400 if the action is unknown or the id isn't a uuid);
 *   2. check the caller is a moderator — read with the server key, so nothing in the request can
 *      fake it (403 otherwise; a non-moderator learns nothing else);
 *   3. do the action:
 *      - remove-post: delete the post (its votes and comments go with it), delete its photo from
 *        storage if it was a photo post, and mark the open reports about it resolved. The
 *        author's own workout log is deliberately left alone — moderation removes what was
 *        shared, not the training record;
 *      - remove-comment: delete the comment and mark its open reports resolved;
 *      - remove-account: refuse if the target is a moderator (a founder deleting themselves by a
 *        typo is the failure this guards), else delete the login — which removes the profile and
 *        everything the lifter owns, because every table's link to a profile is "delete with
 *        it" — then sweep the lifter's folders in the `post-images` and `avatars` storage
 *        buckets. Reports about or by the account vanish with it (the same cascade).
 *   4. answer 200 with what was removed, or 404 if there was nothing to remove.
 *
 * The account sweep runs even when the login is already gone, so asking again after a sweep
 * that failed half-way finishes the job instead of answering "not found".
 */

/** The three removals the founder can ask for. */
export type ModerateAction = 'remove-post' | 'remove-comment' | 'remove-account';

/** The bucket a photo post's picture lives in. */
export const POST_IMAGES_BUCKET = 'post-images';

/** The storage buckets an account's files live in, each in a folder named by the lifter's id. */
export const ACCOUNT_BUCKETS = [POST_IMAGES_BUCKET, 'avatars'] as const;

/** A post as removal needs it: its id, and its photo's storage path (null for a workout post). */
export interface ModeratedPost {
  id: string;
  image_path: string | null;
}

/** A comment as removal needs it (its existence, really — the id is what gets deleted). */
export interface ModeratedComment {
  id: string;
}

/**
 * The database and storage access a request needs, all with the server's own key (index.ts);
 * tests pass in-memory fakes.
 */
export interface ModerateDeps {
  /** Is this user listed in `moderators`? */
  isModerator(userId: string): Promise<boolean>;
  /** The post, or null if there is none. */
  readPost(postId: string): Promise<ModeratedPost | null>;
  /** Deletes the post row (votes and comments are deleted with it by the database). */
  deletePost(postId: string): Promise<void>;
  /** The comment, or null if there is none. */
  readComment(commentId: string): Promise<ModeratedComment | null>;
  /** Deletes the comment row. */
  deleteComment(commentId: string): Promise<void>;
  /** Marks every OPEN report about this content resolved; returns how many changed. */
  resolveReports(kind: 'post' | 'comment', targetId: string): Promise<number>;
  /** Does a login with this id exist? */
  accountExists(userId: string): Promise<boolean>;
  /** Deletes the login (and, through the database's cascades, everything the lifter owns). */
  deleteAccount(userId: string): Promise<void>;
  /** Every object path in `bucket` under the folder `folder/` (e.g. `<user id>/photo.jpg`). */
  listFolder(bucket: string, folder: string): Promise<string[]>;
  /** Deletes these object paths from `bucket` (an empty list is never passed). */
  removeObjects(bucket: string, paths: readonly string[]): Promise<void>;
}

/** What one removal took away. */
export type Removed =
  | { kind: 'post'; id: string; photoRemoved: boolean; reportsResolved: number }
  | { kind: 'comment'; id: string; reportsResolved: number }
  | { kind: 'account'; id: string; accountDeleted: boolean; filesRemoved: number };

/** The function's answer: an HTTP status and a JSON body. */
export type ModerateResponse =
  | { status: 200; body: { removed: Removed } }
  | { status: 400 | 403 | 404 | 409; body: { error: string } };

/** A UUID in its usual text form (any version). Ids are always UUIDs in this database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS: readonly ModerateAction[] = ['remove-post', 'remove-comment', 'remove-account'];

/**
 * Reads `{ action, targetId }` out of a request body, or null if either is missing or wrong
 * (an unknown action, an id that isn't a uuid).
 */
export function parseModerateRequest(body: unknown): { action: ModerateAction; targetId: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { action, targetId } = body as { action?: unknown; targetId?: unknown };
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) return null;
  if (typeof targetId !== 'string' || !UUID.test(targetId)) return null;
  return { action: action as ModerateAction, targetId };
}

/** Deletes everything in the lifter's folder of each account bucket; returns how many files went. */
async function sweepAccountFiles(userId: string, deps: ModerateDeps): Promise<number> {
  let removed = 0;
  for (const bucket of ACCOUNT_BUCKETS) {
    const paths = await deps.listFolder(bucket, userId);
    if (paths.length > 0) {
      await deps.removeObjects(bucket, paths);
      removed += paths.length;
    }
  }
  return removed;
}

/**
 * Handles one moderation request (see the file comment). `callerId` is the signed-in user, as
 * the auth server verified their login token. Database or storage failures are thrown for
 * index.ts to report as a server error.
 */
export async function handleModerateRequest(
  body: unknown,
  callerId: string,
  deps: ModerateDeps,
): Promise<ModerateResponse> {
  const request = parseModerateRequest(body);
  if (!request) {
    return { status: 400, body: { error: 'Send { action: remove-post | remove-comment | remove-account, targetId: <uuid> }' } };
  }
  if (!(await deps.isModerator(callerId))) return { status: 403, body: { error: 'Moderators only' } };

  const { action, targetId } = request;

  if (action === 'remove-post') {
    const post = await deps.readPost(targetId);
    if (!post) return { status: 404, body: { error: 'Post not found' } };
    await deps.deletePost(post.id);
    // The row goes first: once it is gone nobody can be shown the photo (its storage rule reads
    // the post), so a failed file delete leaves an unreachable file, never a visible one.
    if (post.image_path) await deps.removeObjects(POST_IMAGES_BUCKET, [post.image_path]);
    const reportsResolved = await deps.resolveReports('post', post.id);
    return { status: 200, body: { removed: { kind: 'post', id: post.id, photoRemoved: post.image_path != null, reportsResolved } } };
  }

  if (action === 'remove-comment') {
    const comment = await deps.readComment(targetId);
    if (!comment) return { status: 404, body: { error: 'Comment not found' } };
    await deps.deleteComment(comment.id);
    const reportsResolved = await deps.resolveReports('comment', comment.id);
    return { status: 200, body: { removed: { kind: 'comment', id: comment.id, reportsResolved } } };
  }

  // remove-account
  const exists = await deps.accountExists(targetId);
  if (exists && (await deps.isModerator(targetId))) {
    return { status: 409, body: { error: 'A moderator’s account can’t be removed here' } };
  }
  if (exists) await deps.deleteAccount(targetId);
  const filesRemoved = await sweepAccountFiles(targetId, deps);
  if (!exists && filesRemoved === 0) return { status: 404, body: { error: 'Account not found' } };
  return { status: 200, body: { removed: { kind: 'account', id: targetId, accountDeleted: exists, filesRemoved } } };
}
