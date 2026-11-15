/**
 * Reading and writing the on-device training tables.
 *
 * Rows get written in four ways, each separate on purpose. Every feature that
 * changes training data goes through one of them, never through raw SQL:
 *
 *   - `writeLocal` — the USER changed something synced (a custom exercise,
 *     later an edit to a past workout). The row is saved AND recorded in the
 *     outbox so the sync engine pushes it, in one transaction.
 *   - `writeLocalTree` — the same, for a whole workout at once (workout +
 *     entries + sets) in ONE transaction. Finishing a workout uses it: the
 *     workout and everything in it are queued together or not at all, so a
 *     crash can never upload a finished workout missing its sets.
 *   - `writeDraftRows` / `deleteDraftRowsTx` — the workout that is still IN
 *     PROGRESS (`ended_at` null). Saved on the device straight away (so a
 *     killed app loses nothing) but deliberately NOT queued: the server only
 *     ever receives finished workouts, and a set removed mid-workout has
 *     nothing to un-upload. Limited to the three workout tables by type, and
 *     refused at runtime for any row whose workout is already finished — a
 *     finished workout is synced data and must take the queued path. See the
 *     B08 plan (docs/feature_plans/active-workout-store.md), section 1.
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
  /**
   * Exercises of one workout sharing this number form a superset (done back-to-back, LOG-11);
   * null when the exercise stands alone.
   */
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
  /** Drop sets (LOG-12): the top set is null, each drop after it is 1, 2, … */
  drop_set_position: number | null;
  /** Timed work (LOG-13): how long it took or lasted, in seconds. */
  duration_seconds: number | null;
  /** Scored WOD work (LOG-13): free text like "7 rounds + 12 reps". Display only. */
  score: string | null;
  /** The lifter's remark about this one set (LOG-3), up to 500 characters. Display only. */
  notes: string | null;
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
    'score',
    'notes',
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

/** The three tables that make up one workout: the workout, its exercise slots, their sets. */
export type WorkoutTreeTable = 'workouts' | 'workout_exercises' | 'sets';

/** Rows of a workout tree, per table; any table may be left out. */
export type WorkoutTreeRows = { [T in WorkoutTreeTable]?: readonly RowByTable[T][] };

/**
 * Saves a whole workout tree as the user's change, in ONE transaction:
 * every row is stamped `updated_at = now`, saved, and added to the outbox,
 * parents before children. If any given entry or set belongs to a workout
 * not in `tree.workouts`, that workout is re-stamped and queued too (the
 * touch-the-root rule, same as `writeLocal`). Afterwards the `onLocalWrite`
 * listeners hear about each table written, so the sync engine pushes soon.
 *
 * Why one transaction matters: finishing a workout queues the workout and
 * all its sets. Split across transactions, a crash in between could upload
 * a finished-looking empty workout for good. Here it is all or nothing.
 */
export async function writeLocalTree(
  db: SqlDriver,
  tree: WorkoutTreeRows,
  options: WriteLocalOptions = {},
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  const tables = (['workouts', 'workout_exercises', 'sets'] as const).filter((t) => (tree[t]?.length ?? 0) > 0);
  if (tables.length === 0) return;

  await db.withTransactionAsync(async (tx) => {
    const writtenWorkouts = new Set((tree.workouts ?? []).map((w) => w.id));
    const roots = new Set<string>();
    for (const tbl of tables) {
      const stamped = (tree[tbl] as readonly { id: string }[]).map((r) => ({ ...r, updated_at: now }));
      await upsertRowsTx(tx, tbl, stamped as unknown as readonly RowByTable[typeof tbl][]);
      for (const row of stamped) await enqueueTx(tx, tbl, row.id, now);
      for (const id of await rootWorkoutIds(tx, tbl, stamped)) roots.add(id);
    }
    for (const workoutId of roots) {
      if (writtenWorkouts.has(workoutId)) continue;
      await tx.runAsync('update workouts set updated_at = ? where id = ?', [now, workoutId]);
      await enqueueTx(tx, 'workouts', workoutId, now);
    }
  });

  for (const tbl of tables) listeners.get(db)?.forEach((listener) => listener(tbl));
}

/**
 * Throws unless every given workout is still in progress (`ended_at` null).
 * Ids that don't exist pass — there is nothing finished to protect. This is
 * what keeps the draft paths from silently editing synced data.
 */
async function assertDraftWorkoutsTx(tx: SqlExecutor, workoutIds: readonly string[]): Promise<void> {
  if (workoutIds.length === 0) return;
  const finished = await tx.getAllAsync<{ id: string }>(
    `select id from workouts where ended_at is not null and id in (${placeholders(workoutIds.length)})`,
    workoutIds,
  );
  if (finished.length > 0) {
    throw new Error(`Workout ${finished[0].id} is finished; its rows must be written with writeLocal, not as a draft`);
  }
}

/**
 * Saves rows of an IN-PROGRESS workout, inside an already-open transaction:
 * stamps `updated_at = now` and upserts, without queueing anything for upload
 * (see the file comment for why drafts stay off the outbox until finish).
 *
 * Throws (and the caller's transaction rolls back) for a workout row with an
 * `ended_at`, or for an entry/set whose workout is already finished.
 */
export async function writeDraftRowsTx<T extends WorkoutTreeTable>(
  tx: SqlExecutor,
  tbl: T,
  rows: readonly RowByTable[T][],
  now: string,
): Promise<void> {
  if (rows.length === 0) return;
  if (tbl === 'workouts' && (rows as readonly WorkoutRow[]).some((w) => w.ended_at !== null)) {
    throw new Error('A finished workout cannot be written as a draft; finish goes through writeLocalTree');
  }
  const workoutIds =
    tbl === 'workouts' ? rows.map((r) => r.id) : await rootWorkoutIds(tx, tbl, rows);
  await assertDraftWorkoutsTx(tx, workoutIds);
  await upsertRowsTx(
    tx,
    tbl,
    rows.map((r) => ({ ...r, updated_at: now })),
  );
}

/** `writeDraftRowsTx` in a transaction of its own. */
export async function writeDraftRows<T extends WorkoutTreeTable>(
  db: SqlDriver,
  tbl: T,
  rows: readonly RowByTable[T][],
  options: WriteLocalOptions = {},
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  await db.withTransactionAsync((tx) => writeDraftRowsTx(tx, tbl, rows, now));
}

/**
 * Deletes rows of an IN-PROGRESS workout, inside an already-open transaction.
 * Deleting a workout removes its entries and sets with it, and deleting an
 * entry removes its sets (the device's foreign keys cascade). Purely local:
 * a draft was never uploaded, so there is nothing to tell the server.
 *
 * Throws for rows of a finished workout — deleting synced data needs B14's
 * delete-sync, without which the server copy would come back on the next pull.
 */
export async function deleteDraftRowsTx(
  tx: SqlExecutor,
  tbl: WorkoutTreeTable,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  let workoutIds: string[];
  if (tbl === 'workouts') workoutIds = [...ids];
  else if (tbl === 'workout_exercises') {
    const found = await tx.getAllAsync<{ workout_id: string }>(
      `select distinct workout_id from workout_exercises where id in (${placeholders(ids.length)})`,
      ids,
    );
    workoutIds = found.map((r) => r.workout_id);
  } else {
    const found = await tx.getAllAsync<{ workout_id: string }>(
      `select distinct e.workout_id from sets s join workout_exercises e on e.id = s.workout_exercise_id ` +
        `where s.id in (${placeholders(ids.length)})`,
      ids,
    );
    workoutIds = found.map((r) => r.workout_id);
  }
  await assertDraftWorkoutsTx(tx, workoutIds);
  await tx.runAsync(`delete from ${tbl} where id in (${placeholders(ids.length)})`, ids);
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
