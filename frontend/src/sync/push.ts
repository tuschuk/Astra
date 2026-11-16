/**
 * Upload: sends every change in the outbox to the server.
 *
 * How one push works:
 *   1. For each table, parents first (exercises → programs → weeks → program
 *      workouts → workouts → entries → sets → personal records → program
 *      exercises → program runs — `SYNC_ORDER` in db/dao.ts — so the server
 *      never sees a set before its entry, a record before the set it cites,
 *      or a program session before the program workout it names), read which rows are
 *      waiting and each one's watermark (see outbox.ts).
 *   2. Read those rows as they are now and send them in batches of up to
 *      PUSH_BATCH_SIZE as insert-or-update-by-id — without `updated_at`,
 *      which the server stamps itself (see `withoutUpdatedAt`).
 *   3. When the server accepts a batch, clear those rows' outbox lines up to
 *      their watermarks.
 *   4. Re-touch the roots. Parents must go first, so the server stamps a
 *      workout BEFORE its new entries and sets arrive. Another device that
 *      downloads in that gap would get the workout without them and, its
 *      bookmark now past the workout, never look again. So when a batch of
 *      entries or sets is accepted, their workouts are queued again (in the
 *      same transaction as the acknowledgement), and a final workouts pass
 *      re-sends them. The server re-stamps each workout after its contents
 *      landed, which keeps the touch-the-root promise the download relies on
 *      (pull.ts). If that pass fails, the workouts stay queued for next time.
 *   5. On any failure, stop. Nothing is marked failed — whatever wasn't
 *      cleared is still in the outbox, and the next sync tries again.
 *      Known limit: a row the server refuses every time (for example one
 *      breaking a server-side rule the device doesn't repeat) blocks the
 *      uploads queued behind it. See the B07 plan's risks.
 *
 * Why a retry can never duplicate a workout: every row carries the id the
 * phone gave it, and the server's insert-or-update keys on that id. Sending a
 * row twice updates it to the same values. Exactly-once is the primary key's
 * doing, not this code's.
 *
 * Deletes (B14) are sent in a phase of their own BEFORE all of the above —
 * see `pushOutbox` for why that order matters. A row with upload lines that
 * no longer exists on the device (it was deleted after being edited) uploads
 * nothing; those lines are simply cleared, and its delete line has already
 * told the server.
 *
 * The lifter's settings row (B15) goes last, in a phase of its own
 * (`pushUserSettingsPhase`): it is keyed by user rather than by id and may
 * only be updated on the server, so it doesn't fit the batches above.
 *
 * The lifter's own posts (B21) go after that, in the last phase of all
 * (`pushPostsPhase`) — after the workouts they share, which the server
 * requires to be there first.
 */
import type { SqlDriver } from '@/db/driver';
import { deletePostsTx, getRowsByIds, rootWorkoutIds, SYNC_ORDER, type RowByTable, type SyncedTable } from '@/db/dao';
import { readUserSettingsRow, settableFields } from '@/db/userSettings';
import { mimeTypeForPath } from '@/social/mediaLimits';
import { localPostImageFiles, localPostImageUri, type LocalPostImageFiles } from '@/social/postImages';

import { acknowledge, pendingRows } from './outbox';
import { PostAlreadyExistsError, type PushRow, type SyncTransport } from './transport';

/**
 * Drops `updated_at` from a row before upload, so the server stamps it with
 * its own clock (why: see `PushRow` in transport.ts). `created_at` is kept —
 * it records when the user actually logged the row, even if that was offline.
 */
export function withoutUpdatedAt<T extends SyncedTable>(row: RowByTable[T]): PushRow<T> {
  const { updated_at: _serverStamped, ...rest } = row as RowByTable[T] & { updated_at: string };
  return rest as PushRow<T>;
}

/** Most rows sent in one request. */
export const PUSH_BATCH_SIZE = 500;

/**
 * The tables in upload order: parents first, then workouts once more to
 * re-touch the roots of whatever entries and sets just landed (file comment,
 * step 4).
 */
export const PUSH_PASSES: readonly SyncedTable[] = [...SYNC_ORDER, 'workouts'];

/**
 * The delete phase's table order: children first (the reverse of SYNC_ORDER).
 * Mostly a tidiness rule — the server cascades a parent's children anyway —
 * but it means a personal record's delete always lands before anything that
 * could re-create it.
 */
export const DELETE_PASSES: readonly SyncedTable[] = [...SYNC_ORDER].reverse();

/** Most ids in one delete request (they travel in the URL, like the pull's id lists). */
export const DELETE_BATCH_SIZE = 100;

/** What one push did (returned to the engine; the tests check it). */
export interface PushResult {
  /** Rows the server accepted per table, counting both workout passes. */
  pushed: Record<SyncedTable, number>;
  /** Rows deleted on the server per table (B14) — explicit deletes only, not cascades. */
  deleted: Record<SyncedTable, number>;
  /** Settings rows sent (B15): 1 when the kg/lb choice changed on this phone, else 0. */
  userSettings: number;
  /** The lifter's own posts the server accepted (B21). */
  posts: number;
}

/** A per-table counter starting at zero. */
function zeroCounts(): Record<SyncedTable, number> {
  return {
    exercises: 0,
    workouts: 0,
    workout_exercises: 0,
    sets: 0,
    personal_records: 0,
    programs: 0,
    program_weeks: 0,
    program_workouts: 0,
    program_exercises: 0,
    program_runs: 0,
  };
}

/**
 * Sends everything waiting in the outbox (see the file comment). Throws the
 * transport's error if a batch fails; batches already accepted stay cleared.
 *
 * Deletes go FIRST (B14), before any upload. That order is what makes
 * lowering a personal record work: the phone queues "delete record R" then
 * "upload record R" (the new, lower value). Sent in that order, the server
 * removes the old row and inserts the new one — its keep-best rule, which only
 * guards updates, never sees a lowered update to refuse. Upload first and the
 * keep-best rule would quietly keep the old, wrong record.
 */
export async function pushOutbox(
  db: SqlDriver,
  transport: SyncTransport,
  files: LocalPostImageFiles = localPostImageFiles,
): Promise<PushResult> {
  const pushed = zeroCounts();
  const deleted = zeroCounts();

  for (const tbl of DELETE_PASSES) {
    const pending = await pendingRows(db, tbl, 'delete');
    for (let start = 0; start < pending.length; start += DELETE_BATCH_SIZE) {
      const batch = pending.slice(start, start + DELETE_BATCH_SIZE);
      await transport.deleteRows(
        tbl,
        batch.map((p) => p.rowId),
      );
      await acknowledge(db, tbl, batch, [], 'delete');
      deleted[tbl] += batch.length;
    }
  }

  for (const tbl of PUSH_PASSES) {
    // Marks are read BEFORE the rows, so the rows sent are at least as new as
    // every outbox line about to be cleared.
    const pending = await pendingRows(db, tbl);
    for (let start = 0; start < pending.length; start += PUSH_BATCH_SIZE) {
      const batch = pending.slice(start, start + PUSH_BATCH_SIZE);
      const rows = await getRowsByIds(
        db,
        tbl,
        batch.map((p) => p.rowId),
      );
      if (rows.length > 0) {
        await transport.upsert(tbl, rows.map(withoutUpdatedAt));
      }
      // Entries/sets just landed: queue their workouts for the final pass.
      const roots = await rootWorkoutIds(db, tbl, rows);
      await acknowledge(db, tbl, batch, roots);
      pushed[tbl] += rows.length;
    }
  }

  const userSettings = await pushUserSettingsPhase(db, transport);
  const posts = await pushPostsPhase(db, transport, files);

  return { pushed, deleted, userSettings, posts };
}

/**
 * The posts phase (B21), last of all: uploads each of the lifter's queued posts, one request per
 * post (there is at most one per finished workout, so batching would buy nothing).
 *
 * Why last is load-bearing: a post may only be stored on the server about a workout already
 * there (foreign key, and the `owns_workout` security rule). Every training pass runs before this
 * one and stops the whole push on its first failure, so if a post's workout has not landed, this
 * phase never runs — a post can never arrive before its workout. (Side effect, accepted: a
 * failing settings upload holds posts back too, until it clears.)
 *
 * Same watermark rule as everything else: the mark is read before the row, and only lines up to
 * it are cleared. A line whose post is gone from the phone (its workout was deleted) uploads
 * nothing and is cleared.
 *
 * One refusal is not a "try again": `PostAlreadyExistsError` means another device already posted
 * this workout (one post per workout). The workout has its post, so this phone's copy is deleted
 * with all its lines — keeping it would be refused on every sync and block the posts behind it.
 * Any other failure stops the push with the lines kept, like every other phase.
 *
 * Photo posts (B22) take one more step first: their picture is uploaded from the phone's waiting
 * copy (`social/postImages.ts`) to its fixed path in the server bucket, THEN the post row is
 * sent, and once both landed the waiting copy is deleted. That is the whole "background upload
 * with retry": the Post button only saved things on the phone, and this phase — run by the sync
 * engine after each change, on reconnect and on launch — keeps trying until both are up. A retry
 * re-uploads to the same path (replacing it), so nothing is ever duplicated. If the waiting copy
 * has vanished, the post can never upload and is dropped rather than block the queue forever.
 * `files` is the phone's file system (an in-memory one in tests).
 *
 * Returns how many posts the server accepted.
 */
async function pushPostsPhase(db: SqlDriver, transport: SyncTransport, files: LocalPostImageFiles): Promise<number> {
  let sent = 0;
  for (const pending of await pendingRows(db, 'posts')) {
    const [row] = await getRowsByIds(db, 'posts', [pending.rowId]);
    let localImage: string | null = null;
    if (row) {
      localImage = row.image_path ? localPostImageUri(row.image_path) : null;
      // Photo posts (B22): the picture goes up BEFORE the post row. The server only accepts a
      // post naming a photo in its author's folder, and uploading first means the photo is
      // there (readable by its owner only) by the time the post that reveals it lands.
      if (row.image_path !== null && localImage !== null) {
        const mimeType = mimeTypeForPath(row.image_path);
        if (!mimeType || !(await files.exists(localImage))) {
          // The waiting copy is gone (the phone cleared the folder) or was never usable: this
          // post can never upload. Drop it, like a refused duplicate, so it can't block the
          // posts queued behind it.
          await db.withTransactionAsync((tx) => deletePostsTx(tx, [row.id]));
          continue;
        }
        // Same path every time, replacing the file — a retry never duplicates it. Any failure
        // (no signal, refused by the bucket) stops the push with the lines kept: retried next sync.
        await transport.uploadPostImage(row.image_path, localImage, mimeType);
      }
      const { updated_at: _serverStamped, ...upload } = row;
      try {
        await transport.pushPost(upload);
        sent += 1;
      } catch (error) {
        if (!(error instanceof PostAlreadyExistsError)) throw error;
        await db.withTransactionAsync((tx) => deletePostsTx(tx, [row.id]));
        continue;
      }
    }
    await acknowledge(db, 'posts', [pending]);
    // The server holds the photo now; the phone's copy has done its job. Best effort: a file
    // that won't delete is wasted space, not a wrong post, so it never fails the sync.
    if (localImage) await files.remove(localImage).catch(() => undefined);
  }
  return sent;
}

/**
 * The settings phase (B15), after every training table: sends the lifter's kg/lb choice if it
 * changed on this phone since the last upload. Same watermark rule as everything else — the mark
 * is read before the row, and only lines up to it are cleared, so a toggle flipped while this
 * upload is in flight is sent next time rather than lost.
 *
 * The outbox line's row id is the user's id (the settings table's key). A line whose local row
 * is gone uploads nothing and is cleared. Returns how many settings rows were sent (0 or 1 in
 * practice — one row per user).
 */
async function pushUserSettingsPhase(db: SqlDriver, transport: SyncTransport): Promise<number> {
  let sent = 0;
  for (const pending of await pendingRows(db, 'user_settings')) {
    const row = await readUserSettingsRow(db, pending.rowId);
    if (row) {
      await transport.pushUserSettings(row.user_id, settableFields(row));
      sent += 1;
    }
    await acknowledge(db, 'user_settings', [pending]);
  }
  return sent;
}
