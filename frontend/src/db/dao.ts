/**
 * Reading and writing the on-device training tables.
 *
 * There are exactly two ways rows get written, and they are separate on
 * purpose:
 *
 *   - `writeLocal` — the USER changed something (logged a set, renamed a
 *     workout). The row is saved AND recorded in the outbox so the sync engine
 *     pushes it, in one transaction. Every feature that changes training data
 *     goes through here, never through raw SQL.
 *   - `upsertRows` — rows arriving FROM the server (a pull) or from the
 *     bundled library seed. Saved without touching the outbox: they aren't
 *     local changes, and pushing them back would be wasted at best (and, for
 *     library rows, refused by the server's security rules — which would jam
 *     the outbox for good).
 *
 * The touch-the-root rule (load-bearing — see the B07 plan, risk #1): when a
 * workout's entry or set changes, `writeLocal` also re-stamps the parent
 * workout and queues it. That guarantees the server's `workouts.updated_at`
 * moves whenever anything inside the workout changed, which is how other
 * devices' downloads find every changed workout by looking at one table. A
 * write path that skipped this would leave other devices silently stale.
 *
 * Every query the UI runs on these tables must filter by the signed-in
 * user's id — the device file can still hold a previous account's rows.
 */
import { enqueueTx } from '@/sync/outbox';

import { placeholders, type SqlDriver, type SqlExecutor, type SqlValue } from './driver';

/** A library or custom exercise (server table `exercises`). */
export interface ExerciseRow {
  id: string;
  /** null = shared library exercise; a user id = that user's custom exercise. */
  owner_id: string | null;
  name: string;
  primary_muscle: string | null;
  equipment: string | null;
  /** Library rows only — the stable key their id is derived from. */
  slug: string | null;
  created_at: string;
  updated_at: string;
}

/** Who may see a workout (server enum `workout_visibility`). */
export type WorkoutVisibility = 'public' | 'followers' | 'private';

/** One logged session (server table `workouts`). */
export interface WorkoutRow {
  id: string;
  user_id: string;
  title: string | null;
  notes: string | null;
  started_at: string;
  /** null while the workout is still in progress. */
  ended_at: string | null;
  visibility: WorkoutVisibility;
  created_at: string;
  updated_at: string;
}

/** One exercise's slot inside a workout (server table `workout_exercises`). */
export interface WorkoutExerciseRow {
  id: string;
  workout_id: string;
  /** null once the (custom) exercise was deleted — the logged work is kept. */
  exercise_id: string | null;
  position: number;
  notes: string | null;
  superset_group: number | null;
  created_at: string;
  updated_at: string;
}

/** One set: reps at a weight (server table `sets`). Weights are always kg. */
export interface SetRow {
  id: string;
  workout_exercise_id: string;
  position: number;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  is_warmup: boolean;
  drop_set_position: number | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

/** The row shape of each synced table. */
export interface RowByTable {
  exercises: ExerciseRow;
  workouts: WorkoutRow;
  workout_exercises: WorkoutExerciseRow;
  sets: SetRow;
}

/** The four tables mirrored on the device and kept in sync with the server. */
export type SyncedTable = keyof RowByTable;

/**
 * Parents before children: the order rows must reach the server in, so a set
 * never arrives before the entry it belongs to (the server checks that).
 */
export const SYNC_ORDER: readonly SyncedTable[] = ['exercises', 'workouts', 'workout_exercises', 'sets'];

/** Every column of each table, as named on both the device and the server. */
export const TABLE_COLUMNS: { readonly [T in SyncedTable]: readonly (keyof RowByTable[T])[] } = {
  exercises: ['id', 'owner_id', 'name', 'primary_muscle', 'equipment', 'slug', 'created_at', 'updated_at'],
  workouts: ['id', 'user_id', 'title', 'notes', 'started_at', 'ended_at', 'visibility', 'created_at', 'updated_at'],
  workout_exercises: [
    'id',
    'workout_id',
    'exercise_id',
    'position',
    'notes',
    'superset_group',
    'created_at',
    'updated_at',
  ],
  sets: [
    'id',
    'workout_exercise_id',
    'position',
    'reps',
    'weight_kg',
    'rpe',
    'is_warmup',
    'drop_set_position',
    'duration_seconds',
    'created_at',
    'updated_at',
  ],
};

/** Yes/no columns: SQLite stores them as 0/1, the app and server use true/false. */
const BOOLEAN_COLUMNS: { readonly [T in SyncedTable]?: readonly string[] } = {
  sets: ['is_warmup'],
};

/** Converts one app-side value into something SQLite can store. */
function toSql(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  throw new Error(`Cannot store value of type ${typeof value} in the local database`);
}

/** Turns a row read from SQLite back into the app's shape (0/1 → false/true). */
export function fromSqlRow<T extends SyncedTable>(tbl: T, raw: Record<string, unknown>): RowByTable[T] {
  const booleans = BOOLEAN_COLUMNS[tbl];
  if (!booleans) return raw as unknown as RowByTable[T];
  const row: Record<string, unknown> = { ...raw };
  for (const column of booleans) row[column] = row[column] === 1 || row[column] === true;
  return row as unknown as RowByTable[T];
}

/**
 * Builds the "insert, or update the existing row with the same id" statement
 * for a table.
 *
 * Deliberately `ON CONFLICT … DO UPDATE`, never `INSERT OR REPLACE`: REPLACE
 * deletes the old row first, and the delete would cascade — replacing a
 * workout would wipe every set inside it.
 */
function upsertSql(tbl: SyncedTable): string {
  const columns = TABLE_COLUMNS[tbl] as readonly string[];
  const updates = columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  return (
    `insert into ${tbl} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')}) ` +
    `on conflict (id) do update set ${updates.join(', ')}`
  );
}

/** Writes rows (insert-or-update by id) using an already-open transaction. */
export async function upsertRowsTx<T extends SyncedTable>(
  tx: SqlExecutor,
  tbl: T,
  rows: readonly RowByTable[T][],
): Promise<void> {
  const sql = upsertSql(tbl);
  const columns = TABLE_COLUMNS[tbl] as readonly string[];
  for (const row of rows) {
    const record = row as unknown as Record<string, unknown>;
    await tx.runAsync(
      sql,
      columns.map((c) => toSql(record[c])),
    );
  }
}

/**
 * Saves rows that came from the server or the library seed, in one
 * transaction. Does NOT queue them for upload (see the file comment).
 */
export async function upsertRows<T extends SyncedTable>(
  db: SqlDriver,
  tbl: T,
  rows: readonly RowByTable[T][],
): Promise<void> {
  await db.withTransactionAsync((tx) => upsertRowsTx(tx, tbl, rows));
}

/** Reads the rows of `tbl` with the given ids (missing ids are simply absent). */
export async function getRowsByIds<T extends SyncedTable>(
  db: SqlExecutor,
  tbl: T,
  ids: readonly string[],
): Promise<RowByTable[T][]> {
  if (ids.length === 0) return [];
  const columns = (TABLE_COLUMNS[tbl] as readonly string[]).join(', ');
  const raw = await db.getAllAsync<Record<string, unknown>>(
    `select ${columns} from ${tbl} where id in (${placeholders(ids.length)})`,
    ids,
  );
  return raw.map((r) => fromSqlRow(tbl, r));
}

/** Something that wants to hear when a local change has been saved. */
export type LocalWriteListener = (tbl: SyncedTable) => void;

const listeners = new Map<SqlDriver, Set<LocalWriteListener>>();

/**
 * Subscribes to "the user just changed something" on database `db`. The sync
 * engine uses this to push soon after each change. Returns an unsubscribe
 * function.
 */
export function onLocalWrite(db: SqlDriver, listener: LocalWriteListener): () => void {
  const set = listeners.get(db) ?? new Set<LocalWriteListener>();
  set.add(listener);
  listeners.set(db, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(db);
  };
}

/** Options for `writeLocal`. */
export interface WriteLocalOptions {
  /** The current time as ISO-8601 text; injectable so tests are repeatable. */
  now?: string;
}

/**
 * Saves a user's change to the device and queues it for upload — the one
 * write path for training data (see the file comment).
 *
 * Inputs: the table, the full rows to save (insert or update by id).
 * What happens, all in ONE transaction (so a crash leaves either all of it or
 * none of it — the in-progress-workout-survives-a-kill guarantee rests here):
 *   1. each row is saved with `updated_at` stamped to now;
 *   2. each row is added to the outbox;
 *   3. for entries and sets, the parent workout is re-stamped and added to
 *      the outbox too (the touch-the-root rule).
 * After the transaction commits, `onLocalWrite` listeners are told.
 *
 * Throws (and saves nothing) for an exercise with no owner: library
 * exercises belong to the server and can never be uploaded from a phone.
 */
export async function writeLocal<T extends SyncedTable>(
  db: SqlDriver,
  tbl: T,
  rows: readonly RowByTable[T][],
  options: WriteLocalOptions = {},
): Promise<void> {
  if (rows.length === 0) return;
  if (tbl === 'exercises' && (rows as readonly ExerciseRow[]).some((r) => r.owner_id === null)) {
    throw new Error('Library exercises (owner_id null) cannot be written locally; they sync down from the server');
  }
  const now = options.now ?? new Date().toISOString();
  const stamped = rows.map((r) => ({ ...r, updated_at: now }));

  await db.withTransactionAsync(async (tx) => {
    await upsertRowsTx(tx, tbl, stamped);
    for (const row of stamped) await enqueueTx(tx, tbl, row.id, now);

    const rootIds = await rootWorkoutIds(tx, tbl, stamped);
    for (const workoutId of rootIds) {
      await tx.runAsync('update workouts set updated_at = ? where id = ?', [now, workoutId]);
      await enqueueTx(tx, 'workouts', workoutId, now);
    }
  });

  listeners.get(db)?.forEach((listener) => listener(tbl));
}

/**
 * The workouts that contain the given entries or sets (an empty list for
 * workouts and exercises, which have no parent workout). Used by `writeLocal`
 * and by the upload's re-touch of roots (sync/push.ts).
 */
export async function rootWorkoutIds(
  tx: SqlExecutor,
  tbl: SyncedTable,
  rows: readonly { id: string }[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  if (tbl === 'workout_exercises') {
    return [...new Set((rows as readonly WorkoutExerciseRow[]).map((r) => r.workout_id))];
  }
  if (tbl === 'sets') {
    const entryIds = [...new Set((rows as readonly SetRow[]).map((r) => r.workout_exercise_id))];
    const found = await tx.getAllAsync<{ workout_id: string }>(
      `select distinct workout_id from workout_exercises where id in (${placeholders(entryIds.length)})`,
      entryIds,
    );
    return found.map((r) => r.workout_id);
  }
  return [];
}
