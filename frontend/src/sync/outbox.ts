/**
 * The outbox: the device's list of changes the server hasn't received yet.
 *
 * Lines are added by the DAO's write paths (db/dao.ts) in the same
 * transaction as the change itself, so a saved change is never missing from
 * the list.
 *
 * Each line has an `op` (B14):
 *   - `upsert` — "send this row as it is now" (insert-or-update by id);
 *   - `delete` — "this row is gone on the phone; delete it on the server".
 *
 * Three design points that keep data from being lost:
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
 *   - Watermarks are kept PER OP. Lowering a personal record is sent as a
 *     delete line followed by an upsert line for the same row id (see
 *     workout/prs.ts for why). The push sends deletes first; if acknowledging
 *     the delete cleared "every line of this row up to the newest", it would
 *     also swallow the upsert that re-creates the record, and the server would
 *     be left without it. So a delete acknowledgement only clears delete lines,
 *     and an upsert acknowledgement only clears upsert lines.
 */
import { placeholders, type SqlDriver, type SqlExecutor } from '@/db/driver';
import type { SyncedTable } from '@/db/dao';

/**
 * Every table the outbox can hold lines for: the five training tables, plus the lifter's
 * settings row (B15). A `user_settings` line's row id is the user's id — that table's key —
 * and it is only ever an upload (the row can't be deleted from the phone). The outbox stores
 * the table name as plain text, so adding a table here changes no stored data.
 */
export type OutboxTable = SyncedTable | 'user_settings';

/** What an outbox line asks the server to do with its row. */
export type OutboxOp = 'upsert' | 'delete';

/** One row waiting to be sent, and the newest outbox line of that op seen for it. */
export interface PendingRow {
  rowId: string;
  /** The highest outbox line id for this row and op at the moment it was read. */
  mark: number;
}

/**
 * The rows of `tbl` waiting to be sent with operation `op` (uploads by
 * default), oldest first, each with its watermark for that op only (see the
 * file comment).
 */
export async function pendingRows(
  db: SqlExecutor,
  tbl: OutboxTable,
  op: OutboxOp = 'upsert',
): Promise<PendingRow[]> {
  const rows = await db.getAllAsync<{ row_id: string; mark: number }>(
    'select row_id, max(id) as mark from outbox where tbl = ? and op = ? group by row_id order by min(id)',
    [tbl, op],
  );
  return rows.map((r) => ({ rowId: r.row_id, mark: r.mark }));
}

/**
 * Adds one outbox line ("row `rowId` of `tbl` needs uploading", or with
 * `op = 'delete'`, "…needs deleting on the server") inside an already-open
 * transaction, so it lands together with whatever caused it.
 */
export async function enqueueTx(
  tx: SqlExecutor,
  tbl: OutboxTable,
  rowId: string,
  now: string,
  op: OutboxOp = 'upsert',
): Promise<void> {
  await tx.runAsync('insert into outbox (tbl, row_id, queued_at, op) values (?, ?, ?, ?)', [tbl, rowId, now, op]);
}

/**
 * Marks rows as received by the server: deletes their outbox lines of
 * operation `op` up to each row's watermark. Newer lines (edits made during
 * the upload) and lines of the other op are kept.
 *
 * `requeueWorkouts` — workouts to queue again (as uploads) in the SAME
 * transaction. The upload uses this after a batch of entries or sets lands,
 * so their workouts are re-sent (and re-stamped by the server) after their
 * contents arrived; see push.ts for why. Because the re-queue is saved with
 * the acknowledgement, a crash or failure in between can't lose it.
 */
export async function acknowledge(
  db: SqlDriver,
  tbl: OutboxTable,
  rows: readonly PendingRow[],
  requeueWorkouts: readonly string[] = [],
  op: OutboxOp = 'upsert',
): Promise<void> {
  if (rows.length === 0 && requeueWorkouts.length === 0) return;
  const now = new Date().toISOString();
  await db.withTransactionAsync(async (tx) => {
    for (const row of rows) {
      await tx.runAsync('delete from outbox where tbl = ? and row_id = ? and op = ? and id <= ?', [
        tbl,
        row.rowId,
        op,
        row.mark,
      ]);
    }
    for (const workoutId of requeueWorkouts) await enqueueTx(tx, 'workouts', workoutId, now);
  });
}

/**
 * Which of the given rows still have changes (of either op) waiting to be
 * sent. The pull uses this to avoid overwriting — or deleting — a local
 * change the server hasn't seen yet.
 */
export async function rowsWithPendingChanges(
  db: SqlExecutor,
  tbl: OutboxTable,
  ids: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  // In pieces, so a long id list never exceeds SQLite's limit on bound values.
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK);
    const rows = await db.getAllAsync<{ row_id: string }>(
      `select distinct row_id from outbox where tbl = ? and row_id in (${placeholders(part.length)})`,
      [tbl, ...part],
    );
    for (const r of rows) found.add(r.row_id);
  }
  return found;
}

/**
 * Throws away every waiting line for the given rows, inside an open
 * transaction. Only the download uses this, when the server says a workout
 * was deleted on another device: lines about rows that no longer exist
 * anywhere must not be sent (an upload would re-create a gutted workout, or
 * be refused forever for a missing parent). See pull.ts.
 */
export async function dropLinesTx(tx: SqlExecutor, tbl: OutboxTable, ids: readonly string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK);
    await tx.runAsync(`delete from outbox where tbl = ? and row_id in (${placeholders(part.length)})`, [tbl, ...part]);
  }
}

/** Most ids bound into one outbox statement (SQLite's bound-value limit is far above this). */
const ID_CHUNK = 500;

/** How many outbox lines are waiting in total (for tests and diagnostics). */
export async function outboxSize(db: SqlExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('select count(*) as n from outbox');
  return row?.n ?? 0;
}
