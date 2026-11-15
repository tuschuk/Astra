/**
 * Download: brings the server's changes to the user's own data onto the
 * device — their workouts (with every entry and set inside them), the
 * exercises they can see (the shared library plus their customs), their
 * personal records (B13), their workout analyses (B18), their settings
 * row (B15, read whole each time — see `pullUserSettingsPass`), and the
 * flair list posts are labelled with (B21, replaced whole each time).
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
 * Programs (B34) are NOT a tree pull: each of the four program tables has its own bookmark and
 * is downloaded like any stand-alone table, parents first. That is safe only because the server
 * lets nobody but the author read any program row, so an unfiltered download of a child table
 * returns exactly the lifter's own rows (the workout tree needs its one-bookmark design because
 * other people's children are readable through a visible workout). Program deletions are
 * `deleted_at` stamps — ordinary updates — so they need no tombstones. If another phone uploads a
 * new program and its first week between this phone's programs pass and weeks pass, the week can
 * land before its program; the phone's program tables have no local foreign keys for exactly this
 * reason (db/schema.ts V12), so the week just waits unseen — reads walk down from the program —
 * until the next sync brings the program.
 *
 * Program runs (B35) follow the same stand-alone shape on their own bookmark, after the four
 * program tables, narrowed to the lifter's `user_id`. A run is never deleted — ending it is an
 * update — so it needs no tombstones either.
 *
 * Deletions (B14) arrive two ways, because a download cannot see a row that
 * no longer exists:
 *   - inside a workout: a removed set or exercise re-stamps its workout, so
 *     the whole workout is re-downloaded and anything the server's copy no
 *     longer holds is removed here (`reconcileTrees`);
 *   - a whole workout, or a personal record: the server keeps a "tombstone"
 *     note for each, and a last pass reads them after its own bookmark and
 *     deletes the local copies (`applyTombstone`).
 *
 * Three safety rules:
 *   - A row with an unsent local change is never overwritten — or removed.
 *     The user's offline edit wins on the device until it is uploaded; after
 *     that the server's copy (now including the edit) flows back normally.
 *     (One deliberate exception: a workout deleted on another device; see
 *     `applyTombstone`.)
 *   - Each pull starts PULL_OVERLAP_MS before the bookmark. The server stamps
 *     a row when its transaction starts, so a slow save can appear slightly
 *     "behind" a bookmark that already moved past; re-reading the margin
 *     catches it, and re-saving a row already on the device changes nothing.
 *   - Entry and set downloads ask for at most CHILD_CHUNK_SIZE ids per request,
 *     so a large page never builds a request URL the server rejects.
 */
import { timestampMs } from '@analysis';

import { placeholders, type SqlDriver, type SqlExecutor } from '@/db/driver';
import {
  deleteWorkoutPostsTx,
  PROGRAM_TABLES,
  saveServerAnalysesTx,
  type ProgramTable,
  upsertRowsTx,
  type MirrorRowByTable,
  type RowByTable,
  type SyncedTable,
} from '@/db/dao';
import { replaceFlairsTx } from '@/db/flairs';
import { writeUserSettingsRowTx, type UserSettingsRow } from '@/db/userSettings';

import { dropLinesTx, rowsWithPendingChanges } from './outbox';
import type { PullCursor, SyncTransport, TombstoneRow } from './transport';

/** Rows per downloaded page. */
export const PULL_PAGE_SIZE = 500;
/** Most ids in one entries/sets request. */
export const CHILD_CHUNK_SIZE = 100;
/** How far behind the bookmark each pull starts (see the file comment). */
export const PULL_OVERLAP_MS = 5000;

/** The lowest possible id, used as the tie-breaker when rewinding a bookmark. */
const MIN_ID = '00000000-0000-0000-0000-000000000000';

/** `sync_state` keys of the nine bookmarks (four of them the program tables', B34; one the runs', B35). */
export const CURSOR_KEYS = {
  workouts: 'pull_cursor:workouts',
  exercises: 'pull_cursor:exercises',
  personal_records: 'pull_cursor:personal_records',
  workout_analyses: 'pull_cursor:workout_analyses',
  programs: 'pull_cursor:programs',
  program_weeks: 'pull_cursor:program_weeks',
  program_workouts: 'pull_cursor:program_workouts',
  program_exercises: 'pull_cursor:program_exercises',
  program_runs: 'pull_cursor:program_runs',
} as const;

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
  const time = toMs(cursor.updated_at);
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
  personal_records: number;
  /** Workout analyses saved on the phone (B18). */
  workout_analyses: number;
  /** Program rows saved on the phone (B34), per table. */
  programs: number;
  program_weeks: number;
  program_workouts: number;
  program_exercises: number;
  /** Program runs saved on the phone (B35). */
  program_runs: number;
  /** Local slots and sets removed because the server's copy of their workout no longer has them (B14). */
  removed: number;
  /** Tombstones that deleted something on the device (B14). */
  tombstones: number;
  /** 1 if the server's settings row was saved on the phone (B15), else 0. */
  userSettings: number;
  /** Flairs saved on the phone (B21) — the whole list, replaced; 0 if it couldn't be read. */
  flairs: number;
  /**
   * Set when the flair refresh failed (B21). Kept here rather than thrown: it is the last step,
   * every other table is already saved, and the old flairs keep serving — so one failed read of
   * a four-row list must not count as a failed download (which would skip the analysis requests).
   * The engine logs it; the next sync tries again.
   */
  flairsError?: unknown;
}

/**
 * Downloads one stand-alone table (no children) page by page, from the
 * rewound bookmark until a short page says there is nothing more. Each page
 * and its bookmark are saved in one transaction.
 *
 * Analyses (B18) are saved as they come: they never have outbox lines (the
 * phone never writes one of its own), so there is no local change to protect.
 */
async function pullStandalone<
  T extends 'exercises' | 'personal_records' | 'workout_analyses' | ProgramTable | 'program_runs',
>(
  db: SqlDriver,
  tbl: T,
  fetchPage: (after: PullCursor | null) => Promise<MirrorRowByTable[T][]>,
  result: PullResult,
): Promise<void> {
  const key = CURSOR_KEYS[tbl];
  let after = rewind(await readCursor(db, key));
  for (;;) {
    const page = await fetchPage(after);
    if (page.length === 0) return;
    const next = lastCursor(page);
    await db.withTransactionAsync(async (tx) => {
      if (tbl === 'workout_analyses') {
        await saveServerAnalysesTx(tx, page as readonly MirrorRowByTable['workout_analyses'][]);
        result.workout_analyses += page.length;
      } else {
        const synced = tbl as Exclude<T, 'workout_analyses'>;
        result[synced] += await applyRows(tx, synced, page as readonly RowByTable[typeof synced][]);
      }
      await writeCursor(tx, key, next);
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
      result.removed += await reconcileTrees(
        tx,
        workouts.map((w) => w.id),
        entries,
        sets,
      );
      await writeCursor(tx, CURSOR_KEYS.workouts, next);
    });
    if (workouts.length < PULL_PAGE_SIZE) return;
    after = next;
  }
}

/**
 * Runs a query that selects an `id` column filtered by one `in (?)` list, for any number of
 * `values`: `sql` must contain the literal text `(?)` exactly once, which is replaced by the
 * right number of placeholders for each piece of at most ID_CHUNK values (so a long list never
 * exceeds SQLite's limit on bound values). Returns every id found, across all pieces.
 */
async function idsWhereIn(tx: SqlExecutor, sql: string, values: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const part of chunk(values, ID_CHUNK)) {
    const rows = await tx.getAllAsync<{ id: string }>(sql.replace('(?)', `(${placeholders(part.length)})`), part);
    out.push(...rows.map((r) => r.id));
  }
  return out;
}

/**
 * Deletes rows of `tbl` by id on the device only (no outbox line — the server already deleted
 * them), in bound-value-safe pieces.
 */
async function deleteIds(tx: SqlExecutor, tbl: SyncedTable, ids: readonly string[]): Promise<void> {
  for (const part of chunk(ids, ID_CHUNK)) {
    await tx.runAsync(`delete from ${tbl} where id in (${placeholders(part.length)})`, part);
  }
}

/** Most ids bound into one local statement here. */
const ID_CHUNK = 500;

/**
 * Makes the device's copy of each just-downloaded workout hold exactly what the server's does
 * (B14): any local exercise slot or set of those workouts that the server's complete lists no
 * longer contain was removed on another device, so it is removed here too.
 *
 * Why this is enough to carry in-workout deletions: removing a set or an exercise re-stamps its
 * workout (the touch-the-root rule), so every other device re-downloads that whole workout and
 * lands here. No per-set tombstones are needed.
 *
 * The guard: a row with unsent local changes is never removed — a set logged or edited offline
 * against that workout must survive until it is uploaded. (A set's slot being removed still
 * takes the set with it, through the device's foreign keys: there is nothing left to upload it
 * into.)
 *
 * Personal records citing a removed set are dropped too, with any unsent lines of theirs — the
 * server already cascaded them away, and uploading one would be refused for its missing set,
 * forever, jamming the queue. Returns how many local rows were removed.
 */
async function reconcileTrees(
  tx: SqlExecutor,
  workoutIds: readonly string[],
  serverEntries: readonly RowByTable['workout_exercises'][],
  serverSets: readonly RowByTable['sets'][],
): Promise<number> {
  if (workoutIds.length === 0) return 0;
  const keepEntries = new Set(serverEntries.map((e) => e.id));
  const keepSets = new Set(serverSets.map((s) => s.id));

  const localEntries = await idsWhereIn(tx, 'select id from workout_exercises where workout_id in (?)', workoutIds);
  const extraEntries = localEntries.filter((id) => !keepEntries.has(id));
  const pendingEntries = await rowsWithPendingChanges(tx, 'workout_exercises', extraEntries);
  const goneEntries = extraEntries.filter((id) => !pendingEntries.has(id));

  const localSets = await idsWhereIn(
    tx,
    'select s.id as id from sets s join workout_exercises e on e.id = s.workout_exercise_id where e.workout_id in (?)',
    workoutIds,
  );
  // Sets inside a removed slot go with it (foreign-key cascade), whatever their lines say.
  const cascadedSets = goneEntries.length
    ? await idsWhereIn(tx, 'select id from sets where workout_exercise_id in (?)', goneEntries)
    : [];
  const cascaded = new Set(cascadedSets);
  const extraSets = localSets.filter((id) => !keepSets.has(id) && !cascaded.has(id));
  const pendingSets = await rowsWithPendingChanges(tx, 'sets', extraSets);
  const goneSets = extraSets.filter((id) => !pendingSets.has(id));

  await dropRecordsCitingSets(tx, [...goneSets, ...cascadedSets]);
  await deleteIds(tx, 'sets', goneSets);
  await deleteIds(tx, 'workout_exercises', goneEntries);
  await dropLinesTx(tx, 'sets', cascadedSets);
  return goneEntries.length + goneSets.length + cascadedSets.length;
}

/**
 * Deletes the local personal records whose proof is one of `setIds`, and any unsent lines of
 * theirs (see `reconcileTrees` for why even unsent ones go). The book stays empty until the
 * server's promoted record downloads or the lifter's next finish of that exercise refills it.
 */
async function dropRecordsCitingSets(tx: SqlExecutor, setIds: readonly string[]): Promise<void> {
  if (setIds.length === 0) return;
  const records = await idsWhereIn(tx, 'select id from personal_records where source_set_id in (?)', setIds);
  await dropLinesTx(tx, 'personal_records', records);
  await deleteIds(tx, 'personal_records', records);
}

/** `sync_state` key of the tombstone bookmark: the id of the last tombstone applied. */
export const TOMBSTONE_CURSOR_KEY = 'pull_cursor:tombstones';

/**
 * A server or device timestamp as milliseconds since 1970 (NaN if unreadable) — the shared
 * `timestampMs` (it trims Postgres's microseconds, which not every JavaScript engine parses).
 * Comparing as numbers also makes a device stamp ("…Z") and a server stamp ("…+00:00")
 * comparable, which their text is not.
 */
const toMs = timestampMs;

/**
 * Applies one tombstone — "this row was deleted on the server" — inside a transaction.
 * Returns true if something on the device was deleted.
 *
 * A deleted WORKOUT: the local copy goes, with its slots and sets (foreign-key cascade), the
 * personal records citing those sets, and every unsent outbox line about any of them. Deletion
 * wins over an unsent local edit of that workout, deliberately: the edit's upload would
 * re-create a workout row on the server whose sets are gone for good — an empty husk that
 * could never be fixed. Losing an edit to a workout someone deleted is the lesser harm.
 *
 * A deleted PERSONAL RECORD: the local copy goes UNLESS
 *   - it has unsent changes (this device's upload will settle the server), or
 *   - it was saved at or after the deletion. Record ids are fixed per book, so lowering a
 *     record deletes the row and re-creates it under the same id; the re-created copy (already
 *     downloaded by the records pass, which runs before this one) must not be deleted by the
 *     tombstone of its own re-creation.
 */
async function applyTombstone(tx: SqlExecutor, tombstone: TombstoneRow): Promise<boolean> {
  if (tombstone.tbl === 'workouts') {
    const present = await tx.getFirstAsync<{ id: string }>('select id from workouts where id = ?', [tombstone.row_id]);
    if (!present) return false;
    const entryIds = await idsWhereIn(tx, 'select id from workout_exercises where workout_id in (?)', [tombstone.row_id]);
    const setIds = entryIds.length
      ? await idsWhereIn(tx, 'select id from sets where workout_exercise_id in (?)', entryIds)
      : [];
    await dropRecordsCitingSets(tx, setIds);
    await dropLinesTx(tx, 'sets', setIds);
    await dropLinesTx(tx, 'workout_exercises', entryIds);
    await dropLinesTx(tx, 'workouts', [tombstone.row_id]);
    await tx.runAsync('delete from workouts where id = ?', [tombstone.row_id]);
    // Its analysis too (B18), and its post with any unsent lines (B21): the server's cascade
    // already removed both there, and a queued post of a gone workout could never upload.
    await tx.runAsync('delete from workout_analyses where id = ?', [tombstone.row_id]);
    await deleteWorkoutPostsTx(tx, [tombstone.row_id]);
    return true;
  }
  const record = await tx.getFirstAsync<{ updated_at: string }>('select updated_at from personal_records where id = ?', [
    tombstone.row_id,
  ]);
  if (!record) return false;
  if ((await rowsWithPendingChanges(tx, 'personal_records', [tombstone.row_id])).size > 0) return false;
  if (toMs(record.updated_at) >= toMs(tombstone.deleted_at)) return false;
  await tx.runAsync('delete from personal_records where id = ?', [tombstone.row_id]);
  return true;
}

/**
 * Downloads the user's tombstones after the stored bookmark, a page at a time, and applies
 * them; each page and the bookmark are saved in one transaction. Runs LAST in a pull, after the
 * records pass, for the reason in `applyTombstone`.
 *
 * The sync engine ALSO runs it on its own right before each upload (see engine.ts): a workout
 * another device deleted must be removed here — with its waiting outbox lines — before this
 * device's upload could send an unsent edit of it and re-create it on the server.
 */
export async function pullTombstonePass(
  db: SqlDriver,
  transport: SyncTransport,
  userId: string,
  result: Pick<PullResult, 'tombstones'> = { tombstones: 0 },
): Promise<void> {
  const stored = await db.getFirstAsync<{ value: string }>('select value from sync_state where key = ?', [
    TOMBSTONE_CURSOR_KEY,
  ]);
  let afterId = stored ? Number(JSON.parse(stored.value)) : 0;
  for (;;) {
    const page = await transport.pullTombstones(userId, afterId, PULL_PAGE_SIZE);
    if (page.length === 0) return;
    const last = page[page.length - 1].id;
    await db.withTransactionAsync(async (tx) => {
      for (const tombstone of page) if (await applyTombstone(tx, tombstone)) result.tombstones += 1;
      await tx.runAsync(
        'insert into sync_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
        [TOMBSTONE_CURSOR_KEY, JSON.stringify(last)],
      );
    });
    if (page.length < PULL_PAGE_SIZE) return;
    afterId = last;
  }
}

/**
 * Downloads the user's settings row (B15) and saves it on the phone — unless the phone has an
 * unsent settings change of its own, which wins until it is uploaded (the same rule as every
 * other row). The check and the save share one transaction, so a toggle can't slip in between.
 *
 * No bookmark: there is exactly one row per user, so it is simply read every time.
 *
 * Returns the row that was saved, or null if nothing was (no row on the server, or a local
 * change pending), so the caller can tell the screens.
 */
async function pullUserSettingsPass(
  db: SqlDriver,
  transport: SyncTransport,
  userId: string,
): Promise<UserSettingsRow | null> {
  const row = await transport.pullUserSettings(userId);
  if (!row) return null;
  let saved = false;
  await db.withTransactionAsync(async (tx) => {
    if ((await rowsWithPendingChanges(tx, 'user_settings', [row.user_id])).size > 0) return;
    await writeUserSettingsRowTx(tx, row);
    saved = true;
  });
  return saved ? row : null;
}

/** Optional extras for `pullChanges`. */
export interface PullOptions {
  /**
   * Told about the settings row each time a download saves it (B15), after it is safely on the
   * phone. The app passes the unit store's updater here so a unit changed on another device
   * shows straight away — without the sync code knowing anything about screens.
   */
  onUserSettingsPulled?: (row: UserSettingsRow) => void;
}

/**
 * Downloads everything new for user `userId`: exercises first (workouts point
 * at them), then workouts with their contents, then the user's personal
 * records (they cite sets), then their workout analyses (B18), then their
 * programs table by table (B34), then their program runs (B35), then deletions, then their settings row, then the flair list (B21 — whose
 * failure is recorded in the result, not thrown; see `flairsError`). Throws
 * the transport's error on failure; pages already saved stay saved and their
 * bookmarks stay moved.
 */
export async function pullChanges(
  db: SqlDriver,
  transport: SyncTransport,
  userId: string,
  options: PullOptions = {},
): Promise<PullResult> {
  const result: PullResult = {
    exercises: 0,
    workouts: 0,
    workout_exercises: 0,
    sets: 0,
    personal_records: 0,
    workout_analyses: 0,
    programs: 0,
    program_weeks: 0,
    program_workouts: 0,
    program_exercises: 0,
    program_runs: 0,
    removed: 0,
    tombstones: 0,
    userSettings: 0,
    flairs: 0,
  };
  await pullStandalone(db, 'exercises', (after) => transport.pullExercises(after, PULL_PAGE_SIZE), result);
  await pullWorkoutTrees(db, transport, userId, result);
  await pullStandalone(
    db,
    'personal_records',
    (after) => transport.pullPersonalRecords(userId, after, PULL_PAGE_SIZE),
    result,
  );
  // After the records: an analysis names the records its workout holds, so they land first.
  await pullStandalone(
    db,
    'workout_analyses',
    (after) => transport.pullWorkoutAnalyses(userId, after, PULL_PAGE_SIZE),
    result,
  );
  // The lifter's programs (B34), parents first so a child never lands before its parent.
  for (const tbl of PROGRAM_TABLES) {
    await pullStandalone(db, tbl, (after) => transport.pullProgramRows(tbl, userId, after, PULL_PAGE_SIZE), result);
  }
  // Their program runs (B35), after the programs they name. A run whose program another phone
  // uploaded a moment too late for this sync simply waits unseen (readers require the live
  // program) until the next sync brings it.
  await pullStandalone(
    db,
    'program_runs',
    (after) => transport.pullProgramRuns(userId, after, PULL_PAGE_SIZE),
    result,
  );
  await pullTombstonePass(db, transport, userId, result);
  const settings = await pullUserSettingsPass(db, transport, userId);
  if (settings) {
    result.userSettings = 1;
    options.onUserSettingsPulled?.(settings);
  }
  // Last of all (B21), so its failure can cost nothing but itself (see `flairsError`).
  try {
    const flairs = await transport.pullFlairs();
    result.flairs = await db.withTransactionAsync((tx) => replaceFlairsTx(tx, flairs));
  } catch (error) {
    result.flairsError = error;
  }
  return result;
}
