/**
 * Reading and writing the on-device training tables.
 *
 * Rows get written in four ways, each separate on purpose. Every feature that
 * changes training data goes through one of them, never through raw SQL:
 *
 *   - `writeLocal` / `writeLocalRowsTx` — the USER changed something synced
 *     (a custom exercise, an edit to a past workout). The row is saved AND
 *     recorded in the outbox so the sync engine pushes it, in one
 *     transaction. `deleteLocalRowsTx` is its delete counterpart (B14): the
 *     row is removed and a `delete` line queued for the server.
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
import type { PrKind } from '@training-math';

import { dropLinesTx, enqueueTx, type OutboxTable } from '@/sync/outbox';

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
  /**
   * When the owner deleted this custom exercise (B31); null while it is live, and always null for
   * library rows. A deleted custom is hidden from the Library and the picker but kept, so the
   * lifter's history and PRs keep its name.
   */
  deleted_at: string | null;
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
  /**
   * The program workout this session was started from (B35), or null for an ordinary workout.
   * Set once, when the session starts; finishing it moves the lifter's program run on.
   */
  program_workout_id: string | null;
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

/**
 * One record book's current best for one exercise (server table `personal_records`, B13):
 * the heaviest single (`true1rm`), the heaviest weight for exactly `reps` reps (`repMax`), or
 * the best estimated 1RM (`e1rm`) — and the set that holds it. One row per book, not one per
 * PR ever hit. The id is deterministic per book (see `workout/prs.ts`).
 */
export interface PersonalRecordRow {
  id: string;
  user_id: string;
  exercise_id: string;
  kind: PrKind;
  /** Which rep count's book — rep maxes only (2 and up); null for true1rm and e1rm. */
  reps: number | null;
  /** The best, in kg, rounded to the server column's 3 decimals. */
  value_kg: number;
  /** The set that set this record — its proof. */
  source_set_id: string;
  created_at: string;
  updated_at: string;
}

/**
 * One finished workout's post-workout analysis (server table `workout_analyses`, B18), as the
 * `analyze-workout` server function wrote it; `id` is the workout's id. Download-only on the
 * phone. `new_prs` is the server's JSON list kept as text — read it through
 * `analysis/analysis.ts`, which parses it.
 */
export interface WorkoutAnalysisRow {
  id: string;
  user_id: string;
  engine_version: number;
  total_volume_kg: number;
  total_sets: number;
  working_sets: number;
  duration_seconds: number;
  /** JSON text of the analysis's PR list ([{exercise_id, exercise_name, kind, reps, value_kg}]). */
  new_prs: string;
  headline: string;
  message: string;
  /** The workout's server `updated_at` the analysis was computed from. */
  workout_updated_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * One flair — the label a post wears ("WOD", "Physique Check", …) — as the server's founder-curated
 * `flairs` table holds it (B20). Download-only on the phone (B21), so the Post step can show the
 * chips offline. The names are data, never words in the app's code (SOC-3).
 */
export interface FlairRow {
  /** A stable slug ('wod', 'new-pr', …). */
  id: string;
  /** What the chip shows. */
  name: string;
  /** Display order in the picker, lowest first. */
  position: number;
  /** True for Physique Check: such posts take upvotes only (votes arrive with B23). */
  upvotes_only: boolean;
}

/**
 * What a post is (B22): a shared finished workout, a progress photo, or a photo of a PR moment —
 * or (B28) a re-share of someone else's post. Server column `posts.kind`. The phone never writes
 * a re-share (they are made online from the feed, `social/reshare.ts`), so device rows only ever
 * hold the first three; the type is wide because the feed reads every kind.
 */
export type PostKind = 'workout' | 'progress-pic' | 'pr' | 'reshare';

/** The two kinds of post that are a photo rather than a workout (B22). */
export type ImagePostKind = 'progress-pic' | 'pr';

/**
 * One of the lifter's own posts (server table `posts`, B20), as the Post step after Finish
 * (B21) or the Share a photo screen (B22) writes it. Upload-only on the phone: the feed is read
 * from the server. A workout post links its workout through `workout_id` — and through it the
 * workout's analysis, whose id IS the workout id. A photo post instead names its picture in
 * `image_path`. Exactly one of the two is set, by kind (the server's `posts_kind_shape` rule).
 */
export interface PostRow {
  /** Made on the phone, so a retried upload lands on the same server row. */
  id: string;
  user_id: string;
  flair_id: string;
  /** Which kind of post this is (B22). */
  kind: PostKind;
  /** The shared workout (workout posts only); one post per workout (unique on the phone and the server). */
  workout_id: string | null;
  /**
   * Photo posts only (B22): the picture's path in the server's `post-images` bucket,
   * `<user_id>/<post_id>.<ext>` — the owner's folder, so the server's storage rules can tell
   * whose it is.
   */
  image_path: string | null;
  /** Copied from the workout when the post is made, so the two can't disagree (B20 G7). */
  visibility: WorkoutVisibility;
  created_at: string;
  updated_at: string;
}

/**
 * Who besides its author may see a program (B39), enforced by the server's security rules:
 * 'private' — only the author; 'followers' — the author's followers (never across a block);
 * 'team' — members of the Teams the author shared it with; 'published' — anyone signed in (the
 * Marketplace lists these). The meaning words shown to the lifter live in `programs/programs.ts`.
 */
export type ProgramVisibility = 'private' | 'followers' | 'team' | 'published';

/**
 * One of the lifter's training programs (server table `programs`, B34) — the top of the
 * week → workout → exercise tree. Only its author can change it; who else can see it is its
 * `visibility` (server security rules, B39). Others never download it onto their phone — they
 * read shared programs online. Removing a program stamps `deleted_at`; the row stays (soft
 * delete — see `programs/programs.ts`).
 */
export interface ProgramRow {
  id: string;
  /** The author — the only person who can change it. */
  user_id: string;
  /** 1–100 characters. */
  name: string;
  /** Who besides the author may see it (B39). New programs start 'private'. */
  visibility: ProgramVisibility;
  /** When it was deleted; null while it is live. */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One week of a program (server table `program_weeks`, B34). Shown as "Week N" by position. */
export interface ProgramWeekRow {
  id: string;
  program_id: string;
  /** Order among the program's weeks, lowest first. Gaps are fine. */
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One workout inside a program week (server table `program_workouts`, B34). */
export interface ProgramWorkoutRow {
  id: string;
  program_week_id: string;
  /** Up to 100 characters; null shows as "Workout N". */
  name: string | null;
  /** Order within the week, lowest first. */
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One exercise slot of a program workout, with what the lifter should aim for (server table
 * `program_exercises`, B34): how many sets, and optionally how many reps, at what load (always
 * kg, like `sets.weight_kg`) and at what RPE.
 */
export interface ProgramExerciseRow {
  id: string;
  program_workout_id: string;
  /** A library (uuidv5 of its slug) or custom exercise id; null if that exercise was removed for good. */
  exercise_id: string | null;
  /** Order within the workout, lowest first. */
  position: number;
  /** At least 1. */
  target_sets: number;
  target_reps: number | null;
  target_weight_kg: number | null;
  target_rpe: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One time the lifter ran one of their programs (server table `program_runs`, B35), and where
 * they are in it: the stored `position` of the next session's week and of that workout within
 * its week (positions, not "Week N" numbers — see `programs/programRuns.ts`). A run is never
 * deleted; it ends (`ended_at`). Several active rows can exist after two offline phones each
 * started one; "the" active run is always the newest (`programRuns.ts` is the only reader).
 */
export interface ProgramRunRow {
  id: string;
  user_id: string;
  program_id: string;
  next_week_position: number;
  next_workout_position: number;
  started_at: string;
  /** Null while the run is active. Never before `started_at`. */
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The row shape of each synced table: the five training tables, (B34) the four program
 * tables and (B35) the program runs, uploaded and downloaded through the generic machinery. (The phone also uploads its
 * settings row and its own posts, each through a small path of its own — see `OutboxTable` in
 * sync/outbox.ts.)
 */
export interface RowByTable {
  exercises: ExerciseRow;
  workouts: WorkoutRow;
  workout_exercises: WorkoutExerciseRow;
  sets: SetRow;
  personal_records: PersonalRecordRow;
  programs: ProgramRow;
  program_weeks: ProgramWeekRow;
  program_workouts: ProgramWorkoutRow;
  program_exercises: ProgramExerciseRow;
  program_runs: ProgramRunRow;
}

/** The tables mirrored on the device and kept in sync with the server (both directions). */
export type SyncedTable = keyof RowByTable;

/** The four program tables (B34), parents first. */
export const PROGRAM_TABLES = ['programs', 'program_weeks', 'program_workouts', 'program_exercises'] as const;

/** One of the four program tables (B34). */
export type ProgramTable = (typeof PROGRAM_TABLES)[number];

/**
 * Every server table copied onto the phone: the five synced ones plus the download-only
 * `workout_analyses` (B18) and `flairs` (B21), and the upload-only `posts` (B21). Kept as a
 * separate, wider type on purpose: the generic upload paths (`writeLocal`, the batched push) and
 * the bookmarked downloads take `SyncedTable`, so the compiler refuses any attempt to upload an
 * analysis or a flair, or to download into `posts` — each of those has its own small path.
 */
export interface MirrorRowByTable extends RowByTable {
  workout_analyses: WorkoutAnalysisRow;
  flairs: FlairRow;
  posts: PostRow;
}

/** A table mirrored on the device, uploaded or download-only. */
export type MirroredTable = keyof MirrorRowByTable;

/**
 * Parents before children: the order rows must reach the server in, because the
 * server's foreign keys refuse a row whose parent isn't there yet — and a
 * refused row would block the upload queue. Every table here only points at
 * tables earlier in the list:
 *   - a set never before its entry, a personal record never before its set;
 *   - (B35) a workout started from a program names its program workout, so
 *     programs → weeks → program workouts go BEFORE workouts. An honest phone
 *     that built a program and ran a session offline would otherwise upload the
 *     workout first and be refused forever;
 *   - program exercise slots name an exercise (first in the list) and a program
 *     workout; program runs name a program.
 */
export const SYNC_ORDER: readonly SyncedTable[] = [
  'exercises',
  'programs',
  'program_weeks',
  'program_workouts',
  'workouts',
  'workout_exercises',
  'sets',
  'personal_records',
  'program_exercises',
  'program_runs',
];

/** Every column of each table, as named on both the device and the server. */
export const TABLE_COLUMNS: { readonly [T in MirroredTable]: readonly (keyof MirrorRowByTable[T])[] } = {
  exercises: [
    'id',
    'owner_id',
    'name',
    'primary_muscle',
    'equipment',
    'slug',
    'deleted_at',
    'created_at',
    'updated_at',
  ],
  workouts: [
    'id',
    'user_id',
    'title',
    'notes',
    'started_at',
    'ended_at',
    'visibility',
    'program_workout_id',
    'created_at',
    'updated_at',
  ],
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
  personal_records: [
    'id',
    'user_id',
    'exercise_id',
    'kind',
    'reps',
    'value_kg',
    'source_set_id',
    'created_at',
    'updated_at',
  ],
  programs: ['id', 'user_id', 'name', 'visibility', 'deleted_at', 'created_at', 'updated_at'],
  program_weeks: ['id', 'program_id', 'position', 'deleted_at', 'created_at', 'updated_at'],
  program_workouts: ['id', 'program_week_id', 'name', 'position', 'deleted_at', 'created_at', 'updated_at'],
  program_exercises: [
    'id',
    'program_workout_id',
    'exercise_id',
    'position',
    'target_sets',
    'target_reps',
    'target_weight_kg',
    'target_rpe',
    'deleted_at',
    'created_at',
    'updated_at',
  ],
  program_runs: [
    'id',
    'user_id',
    'program_id',
    'next_week_position',
    'next_workout_position',
    'started_at',
    'ended_at',
    'created_at',
    'updated_at',
  ],
  workout_analyses: [
    'id',
    'user_id',
    'engine_version',
    'total_volume_kg',
    'total_sets',
    'working_sets',
    'duration_seconds',
    'new_prs',
    'headline',
    'message',
    'workout_updated_at',
    'created_at',
    'updated_at',
  ],
  flairs: ['id', 'name', 'position', 'upvotes_only'],
  posts: ['id', 'user_id', 'flair_id', 'kind', 'workout_id', 'image_path', 'visibility', 'created_at', 'updated_at'],
};

/** Yes/no columns: SQLite stores them as 0/1, the app and server use true/false. */
const BOOLEAN_COLUMNS: { readonly [T in MirroredTable]?: readonly string[] } = {
  sets: ['is_warmup'],
  flairs: ['upvotes_only'],
};

/** Converts one app-side value into something SQLite can store. */
function toSql(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  throw new Error(`Cannot store value of type ${typeof value} in the local database`);
}

/** Turns a row read from SQLite back into the app's shape (0/1 → false/true). */
export function fromSqlRow<T extends MirroredTable>(tbl: T, raw: Record<string, unknown>): MirrorRowByTable[T] {
  const booleans = BOOLEAN_COLUMNS[tbl];
  if (!booleans) return raw as unknown as MirrorRowByTable[T];
  const row: Record<string, unknown> = { ...raw };
  for (const column of booleans) row[column] = row[column] === 1 || row[column] === true;
  return row as unknown as MirrorRowByTable[T];
}

/**
 * Builds the "insert, or update the existing row with the same id" statement
 * for a table.
 *
 * Deliberately `ON CONFLICT … DO UPDATE`, never `INSERT OR REPLACE`: REPLACE
 * deletes the old row first, and the delete would cascade — replacing a
 * workout would wipe every set inside it.
 */
function upsertSql(tbl: MirroredTable): string {
  const columns = TABLE_COLUMNS[tbl] as readonly string[];
  const updates = columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  return (
    `insert into ${tbl} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')}) ` +
    `on conflict (id) do update set ${updates.join(', ')}`
  );
}

/** Insert-or-update by id for any mirrored table — the untyped core of the two entry points below. */
async function upsertMirrorRowsTx(tx: SqlExecutor, tbl: MirroredTable, rows: readonly object[]): Promise<void> {
  const sql = upsertSql(tbl);
  const columns = TABLE_COLUMNS[tbl] as readonly string[];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    await tx.runAsync(
      sql,
      columns.map((c) => toSql(record[c])),
    );
  }
}

/** Writes rows (insert-or-update by id) using an already-open transaction. */
export async function upsertRowsTx<T extends SyncedTable>(
  tx: SqlExecutor,
  tbl: T,
  rows: readonly RowByTable[T][],
): Promise<void> {
  await upsertMirrorRowsTx(tx, tbl, rows);
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

/**
 * Saves analysis rows the SERVER sent (B18) — a download, or the server function's reply —
 * inside an already-open transaction. Insert-or-update by id; never queued: the phone never
 * uploads an analysis. Its own entry point so the upload-side types never admit the table.
 */
export async function saveServerAnalysesTx(tx: SqlExecutor, rows: readonly WorkoutAnalysisRow[]): Promise<void> {
  await upsertMirrorRowsTx(tx, 'workout_analyses', rows);
}

/** Reads the rows of `tbl` with the given ids (missing ids are simply absent). */
export async function getRowsByIds<T extends MirroredTable>(
  db: SqlExecutor,
  tbl: T,
  ids: readonly string[],
): Promise<MirrorRowByTable[T][]> {
  if (ids.length === 0) return [];
  const columns = (TABLE_COLUMNS[tbl] as readonly string[]).join(', ');
  const raw = await db.getAllAsync<Record<string, unknown>>(
    `select ${columns} from ${tbl} where id in (${placeholders(ids.length)})`,
    ids,
  );
  return raw.map((r) => fromSqlRow(tbl, r));
}

/**
 * Something that wants to hear when a local change has been saved — to a training table, or
 * (B15) to the lifter's settings row.
 */
export type LocalWriteListener = (tbl: OutboxTable) => void;

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
  await db.withTransactionAsync((tx) => writeLocalRowsTx(tx, tbl, rows, now));
  notifyLocalWrite(db, [tbl]);
}

/**
 * The heart of `writeLocal`, inside an already-open transaction: stamps each
 * row `updated_at = now`, saves it, queues it for upload, and applies the
 * touch-the-root rule (an entry's or set's workout is re-stamped and queued
 * too). The one home of that rule for single-table writes — editing a
 * finished workout (B14, `workout/editWorkout.ts`) writes through here so its
 * changes reach other devices exactly like any other synced change.
 *
 * The caller must tell the listeners afterwards (`notifyLocalWrite`), once its
 * transaction has committed.
 */
export async function writeLocalRowsTx<T extends SyncedTable>(
  tx: SqlExecutor,
  tbl: T,
  rows: readonly RowByTable[T][],
  now: string,
): Promise<void> {
  if (rows.length === 0) return;
  const stamped = rows.map((r) => ({ ...r, updated_at: now }));
  await upsertRowsTx(tx, tbl, stamped);
  for (const row of stamped) await enqueueTx(tx, tbl, row.id, now);
  await touchRootsTx(tx, await rootWorkoutIds(tx, tbl, stamped), now);
}

/** Re-stamps the given workouts and queues them for upload (the touch-the-root rule). */
async function touchRootsTx(tx: SqlExecutor, workoutIds: readonly string[], now: string): Promise<void> {
  for (const workoutId of workoutIds) {
    await tx.runAsync('update workouts set updated_at = ? where id = ?', [now, workoutId]);
    await enqueueTx(tx, 'workouts', workoutId, now);
  }
}

/**
 * Deletes SYNCED rows (from a finished workout, or a personal record) on the
 * device and queues the deletion for the server — B14's counterpart of
 * `writeLocalRowsTx`, inside an already-open transaction.
 *
 * What happens:
 *   1. the parent workouts of any entries / sets are looked up (before the
 *      rows are gone);
 *   2. the rows are deleted — the device's foreign keys take a workout's
 *      entries and sets, or an entry's sets, with it; a deleted workout's
 *      analysis (B18) and its post with any unsent upload lines (B21,
 *      `deleteWorkoutPostsTx`) are deleted here too;
 *   3. one `delete` outbox line per given row. Only the given rows: the
 *      server's foreign keys cascade the same way, so queuing the children too
 *      would be redundant traffic. Any upload lines the children still had
 *      are retired harmlessly by the push (their rows are gone, so nothing is
 *      sent — see push.ts);
 *   4. the parent workouts that still exist are re-stamped and queued (the
 *      touch-the-root rule), so other devices re-download them and drop what
 *      was removed (see pull.ts).
 *
 * The caller must tell the listeners afterwards (`notifyLocalWrite`).
 */
export async function deleteLocalRowsTx(
  tx: SqlExecutor,
  tbl: SyncedTable,
  ids: readonly string[],
  now: string,
): Promise<void> {
  if (ids.length === 0) return;
  const roots = tbl === 'workout_exercises' || tbl === 'sets' ? await workoutIdsOf(tx, tbl, ids) : [];
  await tx.runAsync(`delete from ${tbl} where id in (${placeholders(ids.length)})`, ids);
  // A deleted workout's analysis (B18) goes with it, as the server's cascade does. The mirror
  // has no foreign key to do it, and the row was never queued, so nothing is sent for it.
  if (tbl === 'workouts') {
    await tx.runAsync(`delete from workout_analyses where id in (${placeholders(ids.length)})`, ids);
    await deleteWorkoutPostsTx(tx, ids);
  }
  for (const id of ids) await enqueueTx(tx, tbl, id, now, 'delete');
  await touchRootsTx(tx, roots, now);
}

/**
 * Removes the phone's posts of the given workouts, and every outbox line still waiting to upload
 * them, inside an already-open transaction (B21). Used wherever a workout is deleted on the
 * phone — by the lifter (`deleteLocalRowsTx`) or because another device deleted it (the
 * download's tombstone pass) — since the device tables have no foreign key to cascade it.
 *
 * Why the waiting lines must go too: the server deletes a workout's post with the workout, and a
 * queued post whose workout no longer exists would be refused on every upload, forever, blocking
 * the posts queued behind it. Nothing is queued for the server: its own cascade removes the post.
 */
export async function deleteWorkoutPostsTx(tx: SqlExecutor, workoutIds: readonly string[]): Promise<void> {
  if (workoutIds.length === 0) return;
  const posts = await tx.getAllAsync<{ id: string }>(
    `select id from posts where workout_id in (${placeholders(workoutIds.length)})`,
    workoutIds,
  );
  await deletePostsTx(
    tx,
    posts.map((p) => p.id),
  );
}

/**
 * Deletes the given posts from the phone along with every outbox line still waiting to upload
 * them, inside an already-open transaction (B21). Nothing is queued for the server. The one home
 * of "this post is settled — forget it here": used when its workout is deleted
 * (`deleteWorkoutPostsTx`) and when the server says the workout already has a post from another
 * device (sync/push.ts).
 */
export async function deletePostsTx(tx: SqlExecutor, postIds: readonly string[]): Promise<void> {
  if (postIds.length === 0) return;
  await dropLinesTx(tx, 'posts', postIds);
  await tx.runAsync(`delete from posts where id in (${placeholders(postIds.length)})`, postIds);
}

/**
 * Tells the `onLocalWrite` listeners (the sync engine) that the user changed
 * these tables. Call it only after the transaction that saved the change has
 * committed.
 */
export function notifyLocalWrite(db: SqlDriver, tables: readonly OutboxTable[]): void {
  for (const tbl of tables) listeners.get(db)?.forEach((listener) => listener(tbl));
}

/** The three tables that make up one workout: the workout, its exercise slots, their sets. */
export type WorkoutTreeTable = 'workouts' | 'workout_exercises' | 'sets';

/**
 * Rows of a workout tree, per table; any table may be left out. Finishing a
 * workout may also carry the personal records it set (B13) and (B35) the
 * program run it moved on, so they are saved in the same all-or-nothing
 * transaction as the workout itself.
 */
export type WorkoutTreeRows = { [T in WorkoutTreeTable]?: readonly RowByTable[T][] } & {
  personal_records?: readonly PersonalRecordRow[];
  program_runs?: readonly ProgramRunRow[];
};

/**
 * Saves a whole workout tree as the user's change, in ONE transaction:
 * every row is stamped `updated_at = now`, saved, and added to the outbox,
 * parents before children (personal records after sets — they cite sets; the
 * program run last). If any
 * given entry or set belongs to a workout not in `tree.workouts`, that
 * workout is re-stamped and queued too (the touch-the-root rule, same as
 * `writeLocal`); a personal record has no parent workout and syncs on its
 * own. Afterwards the `onLocalWrite` listeners hear about each table
 * written, so the sync engine pushes soon.
 *
 * Why one transaction matters: finishing a workout queues the workout and
 * all its sets (and the PRs they set). Split across transactions, a crash in
 * between could upload a finished-looking empty workout — or a workout whose
 * PRs were silently lost — for good. Likewise (B35) a finished program session
 * and the run it moved on commit together, so a kill can never log the session
 * without advancing the run. Here it is all or nothing.
 */
export async function writeLocalTree(
  db: SqlDriver,
  tree: WorkoutTreeRows,
  options: WriteLocalOptions = {},
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  const tables = (['workouts', 'workout_exercises', 'sets', 'personal_records', 'program_runs'] as const).filter(
    (t) => (tree[t]?.length ?? 0) > 0,
  );
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

  notifyLocalWrite(db, tables);
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
 * Throws for rows of a finished workout — synced data is deleted through
 * `deleteLocalRowsTx`, which also tells the server; without that, the server
 * copy would come back on the next pull.
 */
export async function deleteDraftRowsTx(
  tx: SqlExecutor,
  tbl: WorkoutTreeTable,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const workoutIds = tbl === 'workouts' ? [...ids] : await workoutIdsOf(tx, tbl, ids);
  await assertDraftWorkoutsTx(tx, workoutIds);
  await tx.runAsync(`delete from ${tbl} where id in (${placeholders(ids.length)})`, ids);
}

/** The workouts holding the given entries or sets, as stored right now on the device. */
async function workoutIdsOf(tx: SqlExecutor, tbl: 'workout_exercises' | 'sets', ids: readonly string[]): Promise<string[]> {
  const sql =
    tbl === 'workout_exercises'
      ? `select distinct workout_id from workout_exercises where id in (${placeholders(ids.length)})`
      : `select distinct e.workout_id from sets s join workout_exercises e on e.id = s.workout_exercise_id ` +
        `where s.id in (${placeholders(ids.length)})`;
  const found = await tx.getAllAsync<{ workout_id: string }>(sql, ids);
  return found.map((r) => r.workout_id);
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
