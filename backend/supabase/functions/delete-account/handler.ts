/**
 * What the `delete-account` server function does with one request (B32, NFR-6 — "delete account
 * and content"), separated from the Deno wiring in `index.ts` so it can be tested with fakes
 * (tests never touch the real project).
 *
 * Why it exists: a lifter can delete their own account from Settings, and when they do, nothing
 * of theirs may remain. No app user can delete a login or another folder's files through the
 * database's security rules, so this function — holding the server's own key — is the one door.
 * It only ever opens onto ONE account: the caller's own. The request names no user at all; the
 * account to delete is the one the verified login token belongs to.
 *
 * The request: `{ "confirm": "DELETE" }`. The steps:
 *   1. check the confirmation word is there, exactly (400 otherwise) — a second lock behind the
 *      app's typed confirmation, so a stray call can never delete an account;
 *   2. refuse if the caller is a moderator (409) — the founder's typo guard, same as `moderate`;
 *      a moderator who really means it removes themself from `moderators` first;
 *   3. delete every file in the lifter's folder of the `post-images` and `avatars` buckets
 *      (stored files have no database link to the login, so nothing removes them by itself);
 *   4. delete the login. Every table's link to a profile is "delete with it", and the profile's
 *      link to the login is too, so this one delete removes the profile, every workout, exercise
 *      entry, set, personal record, analysis, custom exercise, post, vote, comment, follow,
 *      block, mute, report, setting and body-data row (verified live, see the B32 plan).
 *
 * Files first, login last — on purpose (the opposite of `moderate`): once the login is gone the
 * caller's token stops working, so they could never ask again. Doing the deletable-by-retry part
 * first means any failure leaves the account intact and the lifter can just try again; a retry
 * after a half-finished sweep simply finds fewer files.
 */

/** The storage buckets an account's files live in, each in a folder named by the lifter's id. */
export const ACCOUNT_BUCKETS = ['post-images', 'avatars'] as const;

/** The exact word the request must carry. */
export const CONFIRMATION_WORD = 'DELETE';

/**
 * The access a request needs, all with the server's own key (index.ts); tests pass fakes.
 * (The storage pair is a deliberate copy of `moderate`'s — see the plan's grilling notes.)
 */
export interface DeleteAccountDeps {
  /** Is this user listed in `moderators`? */
  isModerator(userId: string): Promise<boolean>;
  /** Every object path in `bucket` under the folder `folder/` (e.g. `<user id>/photo.jpg`). */
  listFolder(bucket: string, folder: string): Promise<string[]>;
  /** Deletes these object paths from `bucket` (an empty list is never passed). */
  removeObjects(bucket: string, paths: readonly string[]): Promise<void>;
  /** Deletes the login — and, through the database's cascades, everything the lifter owns. */
  deleteAccount(userId: string): Promise<void>;
}

/** The function's answer: an HTTP status and a JSON body. */
export type DeleteAccountResponse =
  | { status: 200; body: { deleted: { userId: string; filesRemoved: number } } }
  | { status: 400 | 409; body: { error: string } };

/** True only for a body of the form `{ confirm: 'DELETE' }`. */
export function isConfirmed(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { confirm?: unknown }).confirm === CONFIRMATION_WORD;
}

/**
 * Deletes the caller's account (see the file comment). `callerId` is the signed-in user, as the
 * auth server verified their login token. Database or storage failures are thrown for index.ts
 * to report as a server error; nothing after the failing step has run.
 */
export async function handleDeleteAccountRequest(
  body: unknown,
  callerId: string,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResponse> {
  if (!isConfirmed(body)) return { status: 400, body: { error: `Send { confirm: "${CONFIRMATION_WORD}" }` } };
  if (await deps.isModerator(callerId)) {
    return { status: 409, body: { error: 'A moderator’s account can’t be deleted here' } };
  }

  let filesRemoved = 0;
  for (const bucket of ACCOUNT_BUCKETS) {
    const paths = await deps.listFolder(bucket, callerId);
    if (paths.length > 0) {
      await deps.removeObjects(bucket, paths);
      filesRemoved += paths.length;
    }
  }

  await deps.deleteAccount(callerId);
  return { status: 200, body: { deleted: { userId: callerId, filesRemoved } } };
}
