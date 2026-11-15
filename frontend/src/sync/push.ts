/**
 * Upload: sends every change in the outbox to the server.
 *
 * How one push works:
 *   1. For each table, parents first (exercises → workouts → entries → sets
 *      → personal records, so the server never sees a set before its entry or
 *      a record before the set it cites), read which rows are
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
 * A row in the outbox that no longer exists on the device (possible once
 * deletes arrive in B14) uploads nothing; its lines are simply cleared.
 */
import type { SqlDriver } from '@/db/driver';
import { getRowsByIds, rootWorkoutIds, SYNC_ORDER, type RowByTable, type SyncedTable } from '@/db/dao';

import { acknowledge, pendingRows } from './outbox';
import type { PushRow, SyncTransport } from './transport';

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

/** What one push did (returned to the engine; the tests check it). */
export interface PushResult {
  /** Rows the server accepted per table, counting both workout passes. */
  pushed: Record<SyncedTable, number>;
}

/**
 * Uploads everything waiting in the outbox (see the file comment). Throws the
 * transport's error if a batch fails; batches already accepted stay cleared.
 */
export async function pushOutbox(db: SqlDriver, transport: SyncTransport): Promise<PushResult> {
  const pushed: Record<SyncedTable, number> = {
    exercises: 0,
    workouts: 0,
    workout_exercises: 0,
    sets: 0,
    personal_records: 0,
  };

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

  return { pushed };
}
