/**
 * The outbox: the device's list of changes the server hasn't received yet.
 *
 * Lines are added by `writeLocal` (db/dao.ts) in the same transaction as the
 * change itself, so a saved change is never missing from the list.
 *
 * Two design points that keep data from being lost:
 *
 *   - It lists WHICH rows changed, not what they changed to. A push reads each
 *     row as it is right now, so ten edits to one set become one upload of its
 *     latest state.
 *   - The watermark. When a push reads the list it remembers, per row, the
 *     newest line it saw (its "mark"). After the server accepts the upload,
 *     only lines up to that mark are deleted. If the user edits the same row
 *     while the upload is in flight, that edit's line is newer than the mark,
 *     survives, and goes up with the next push. (A simple "dirty" flag would be
 *     cleared by the in-flight upload and the edit would never be sent.)
 */
import { placeholders, type SqlDriver, type SqlExecutor } from '@/db/driver';
import type { SyncedTable } from '@/db/dao';

/** One row waiting to be uploaded, and the newest outbox line seen for it. */
export interface PendingRow {
  rowId: string;
  /** The highest outbox line id for this row at the moment it was read. */
  mark: number;
}

/**
 * The rows of `tbl` waiting to be uploaded, oldest first, each with its
 * watermark (see the file comment).
 */
export async function pendingRows(db: SqlExecutor, tbl: SyncedTable): Promise<PendingRow[]> {
  const rows = await db.getAllAsync<{ row_id: string; mark: number }>(
    'select row_id, max(id) as mark from outbox where tbl = ? group by row_id order by min(id)',
    [tbl],
  );
  return rows.map((r) => ({ rowId: r.row_id, mark: r.mark }));
}

/**
 * Adds one outbox line ("row `rowId` of `tbl` needs uploading") inside an
 * already-open transaction, so it lands together with whatever caused it.
 */
export async function enqueueTx(tx: SqlExecutor, tbl: SyncedTable, rowId: string, now: string): Promise<void> {
  await tx.runAsync('insert into outbox (tbl, row_id, queued_at) values (?, ?, ?)', [tbl, rowId, now]);
}

/**
 * Marks rows as received by the server: deletes their outbox lines up to each
 * row's watermark. Newer lines (edits made during the upload) are kept.
 *
 * `requeueWorkouts` — workouts to queue again in the SAME transaction. The
 * upload uses this after a batch of entries or sets lands, so their workouts
 * are re-sent (and re-stamped by the server) after their contents arrived;
 * see push.ts for why. Because the re-queue is saved with the
 * acknowledgement, a crash or failure in between can't lose it.
 */
export async function acknowledge(
  db: SqlDriver,
  tbl: SyncedTable,
  rows: readonly PendingRow[],
  requeueWorkouts: readonly string[] = [],
): Promise<void> {
  if (rows.length === 0 && requeueWorkouts.length === 0) return;
  const now = new Date().toISOString();
  await db.withTransactionAsync(async (tx) => {
    for (const row of rows) {
      await tx.runAsync('delete from outbox where tbl = ? and row_id = ? and id <= ?', [tbl, row.rowId, row.mark]);
    }
    for (const workoutId of requeueWorkouts) await enqueueTx(tx, 'workouts', workoutId, now);
  });
}

/**
 * Which of the given rows still have changes waiting to be uploaded. The pull
 * uses this to avoid overwriting a local edit the server hasn't seen yet.
 */
export async function rowsWithPendingChanges(
  db: SqlExecutor,
  tbl: SyncedTable,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.getAllAsync<{ row_id: string }>(
    `select distinct row_id from outbox where tbl = ? and row_id in (${placeholders(ids.length)})`,
    [tbl, ...ids],
  );
  return new Set(rows.map((r) => r.row_id));
}

/** How many outbox lines are waiting in total (for tests and diagnostics). */
export async function outboxSize(db: SqlExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('select count(*) as n from outbox');
  return row?.n ?? 0;
}
