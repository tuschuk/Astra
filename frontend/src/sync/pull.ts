/**
 * Download: brings the server's changes to the user's own data onto the
 * device — their workouts (with every entry and set inside them) and the
 * exercises they can see (the shared library plus their customs).
 *
 * How it finds what changed: each table keeps a bookmark in `sync_state` —
 * the (updated_at, id) of the last row downloaded. A pull asks for rows after
 * the bookmark, a page at a time, and moves the bookmark only after the page
 * is safely saved; a crash mid-pull just downloads that page again next time.
 *
 * Workouts are the only workout-side table with a bookmark. Because every
 * change to an entry or set also re-stamps its workout (the touch-the-root
 * rule in db/dao.ts), a changed workout means "re-download this whole
 * workout", and one bookmark finds every change.
 *
 * Three safety rules:
 *   - A row with an unsent local change is never overwritten. The user's
 *     offline edit wins on the device until it is uploaded; after that the
 *     server's copy (now including the edit) flows back normally.
 *   - Each pull starts PULL_OVERLAP_MS before the bookmark. The server stamps
 *     a row when its transaction starts, so a slow save can appear slightly
 *     "behind" a bookmark that already moved past; re-reading the margin
 *     catches it, and re-saving a row already on the device changes nothing.
 *   - Entry and set downloads ask for at most CHILD_CHUNK_SIZE ids per request,
 *     so a large page never builds a request URL the server rejects.
 */
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { upsertRowsTx, type RowByTable, type SyncedTable } from '@/db/dao';

import { rowsWithPendingChanges } from './outbox';
import type { PullCursor, SyncTransport } from './transport';

/** Rows per downloaded page. */
export const PULL_PAGE_SIZE = 500;
/** Most ids in one entries/sets request. */
export const CHILD_CHUNK_SIZE = 100;
/** How far behind the bookmark each pull starts (see the file comment). */
export const PULL_OVERLAP_MS = 5000;

/** The lowest possible id, used as the tie-breaker when rewinding a bookmark. */
const MIN_ID = '00000000-0000-0000-0000-000000000000';

/** `sync_state` keys of the two bookmarks. */
export const CURSOR_KEYS = { workouts: 'pull_cursor:workouts', exercises: 'pull_cursor:exercises' } as const;

type CursorKey = (typeof CURSOR_KEYS)[keyof typeof CURSOR_KEYS];

/** Reads a stored bookmark, or null if this table has never been pulled. */
export async function readCursor(db: SqlDriver, key: CursorKey): Promise<PullCursor | null> {
  const row = await db.getFirstAsync<{ value: string }>('select value from sync_state where key = ?', [key]);
  return row ? (JSON.parse(row.value) as PullCursor) : null;
}

/**
 * Where a pull actually starts: the stored bookmark moved back by the overlap
 * margin (and before any id at that moment), or the very beginning.
 */
export function rewind(cursor: PullCursor | null): PullCursor | null {
  if (!cursor) return null;
  // Postgres sends microseconds (…:00.123456+00:00); not every JavaScript
  // engine parses more than three fraction digits, so trim to milliseconds.
  const time = Date.parse(cursor.updated_at.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(time)) return null;
  return { updated_at: new Date(time - PULL_OVERLAP_MS).toISOString(), id: MIN_ID };
}

/** Splits a list into pieces of at most `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Saves downloaded rows inside a transaction, skipping any row that has an
 * unsent local change. Returns how many were saved.
 */
async function applyRows<T extends SyncedTable>(
  tx: SqlExecutor,
  tbl: T,
  rows: readonly RowByTable[T][],
): Promise<number> {
  if (rows.length === 0) return 0;
  const pending = await rowsWithPendingChanges(
    tx,
    tbl,
    rows.map((r) => r.id),
  );
  const fresh = rows.filter((r) => !pending.has(r.id));
  await upsertRowsTx(tx, tbl, fresh);
  return fresh.length;
}

/** Saves a bookmark inside a transaction. */
async function writeCursor(
  tx: SqlExecutor,
  key: CursorKey,
  cursor: PullCursor,
): Promise<void> {
  await tx.runAsync(
    'insert into sync_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
    [key, JSON.stringify(cursor)],
  );
}

/** The bookmark after a page: its last row. */
function lastCursor(rows: readonly { updated_at: string; id: string }[]): PullCursor {
  const last = rows[rows.length - 1];
  return { updated_at: last.updated_at, id: last.id };
}

/** What one pull saved, for logging and tests. */
export interface PullResult {
  exercises: number;
  workouts: number;
  workout_exercises: number;
  sets: number;
}

/**
 * Downloads exercises the user can see, page by page, from the rewound
 * bookmark until a short page says there is nothing more.
 */
async function pullExercises(db: SqlDriver, transport: SyncTransport, result: PullResult): Promise<void> {
  let after = rewind(await readCursor(db, CURSOR_KEYS.exercises));
  for (;;) {
    const page = await transport.pullExercises(after, PULL_PAGE_SIZE);
    if (page.length === 0) return;
    const next = lastCursor(page);
    await db.withTransactionAsync(async (tx) => {
      result.exercises += await applyRows(tx, 'exercises', page);
      await writeCursor(tx, CURSOR_KEYS.exercises, next);
    });
    if (page.length < PULL_PAGE_SIZE) return;
    after = next;
  }
}

/**
 * Downloads the user's changed workouts page by page; for each page, fetches
 * every entry and set inside those workouts and saves the whole page —
 * workouts, then entries, then sets, then the bookmark — in one transaction.
 */
async function pullWorkoutTrees(
  db: SqlDriver,
  transport: SyncTransport,
  userId: string,
  result: PullResult,
): Promise<void> {
  let after = rewind(await readCursor(db, CURSOR_KEYS.workouts));
  for (;;) {
    const workouts = await transport.pullWorkouts(userId, after, PULL_PAGE_SIZE);
    if (workouts.length === 0) return;

    const entries: RowByTable['workout_exercises'][] = [];
    for (const ids of chunk(
      workouts.map((w) => w.id),
      CHILD_CHUNK_SIZE,
    )) {
      entries.push(...(await transport.pullWorkoutExercises(ids)));
    }
    const sets: RowByTable['sets'][] = [];
    for (const ids of chunk(
      entries.map((e) => e.id),
      CHILD_CHUNK_SIZE,
    )) {
      sets.push(...(await transport.pullSets(ids)));
    }

    const next = lastCursor(workouts);
    await db.withTransactionAsync(async (tx) => {
      result.workouts += await applyRows(tx, 'workouts', workouts);
      result.workout_exercises += await applyRows(tx, 'workout_exercises', entries);
      result.sets += await applyRows(tx, 'sets', sets);
      await writeCursor(tx, CURSOR_KEYS.workouts, next);
    });
    if (workouts.length < PULL_PAGE_SIZE) return;
    after = next;
  }
}

/**
 * Downloads everything new for user `userId`: exercises first (workouts point
 * at them), then workouts with their contents. Throws the transport's error on
 * failure; pages already saved stay saved and their bookmarks stay moved.
 */
export async function pullChanges(db: SqlDriver, transport: SyncTransport, userId: string): Promise<PullResult> {
  const result: PullResult = { exercises: 0, workouts: 0, workout_exercises: 0, sets: 0 };
  await pullExercises(db, transport, result);
  await pullWorkoutTrees(db, transport, userId, result);
  return result;
}
