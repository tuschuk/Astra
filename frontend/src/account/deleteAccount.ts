/**
 * Asking the server to delete the signed-in account (B32, NFR-6 — "delete account and content").
 *
 * What it does: calls the `delete-account` server function with the lifter's login and the
 * confirmation word, and turns the answer into "deleted" or a calm line to show. The server
 * deletes the account the login belongs to — this sends no account id at all.
 *
 * Only a real "deleted" answer counts. No connection, a refusal or a server error all leave the
 * account exactly as it was (the server deletes the login last, so a failure never strands a
 * half-deleted account), and the screen wipes nothing from the phone.
 */
import { callFunction, type FunctionsClient } from './functionCalls';

/** The word the lifter types, and the server requires in the request, to confirm. */
export const DELETE_CONFIRMATION_WORD = 'DELETE';

/** Shown when the request got no answer. */
export const DELETE_OFFLINE = 'Deleting your account needs a connection. Your account is still here.';
/** Shown when the server refused a moderator's account (its 409). */
export const DELETE_MODERATOR = 'A moderator account can’t be deleted here.';
/** Shown for any other failure. */
export const DELETE_FAILED = 'Your account couldn’t be deleted right now. It’s still here — try again.';

/** Deleted, or a message to show (the account is untouched). */
export type DeleteResult = { ok: true } | { ok: false; message: string };

/** Asks the server to delete the signed-in account (see the file comment). Never throws. */
export async function requestAccountDeletion(client: FunctionsClient): Promise<DeleteResult> {
  const outcome = await callFunction(client, 'delete-account', { confirm: DELETE_CONFIRMATION_WORD });
  if (outcome.kind === 'offline') return { ok: false, message: DELETE_OFFLINE };
  if (outcome.kind === 'failed') {
    return { ok: false, message: outcome.status === 409 ? DELETE_MODERATOR : DELETE_FAILED };
  }
  const deleted = (outcome.data as { deleted?: unknown } | null)?.deleted;
  return deleted ? { ok: true } : { ok: false, message: DELETE_FAILED };
}
