/**
 * The sync engine's view of the server: twelve operations, nothing more.
 *
 * Why an interface: the real implementation (`supabaseTransport.ts`) talks to
 * Supabase over the network; tests use an in-memory fake server
 * (`test-utils/fakeTransport.ts`) that can be switched "offline" at will. The
 * engine can't tell the difference, which is what lets Jest prove that a
 * workout logged offline lands on the server exactly once.
 *
 * Rows travel in exactly the shapes defined in `db/dao.ts` — device and
 * server columns share names, so there is no translation layer.
 *
 * Every method throws on failure (no signal, server error, refused by
 * security rules). The engine treats any throw as "try again later".
 */
import type { WeightUnit } from '@training-math';

import type {
  ExerciseRow,
  PersonalRecordRow,
  RowByTable,
  SetRow,
  SyncedTable,
  WorkoutAnalysisRow,
  WorkoutExerciseRow,
  WorkoutRow,
} from '@/db/dao';
import type { UserSettingsRow } from '@/db/userSettings';

/**
 * A bookmark in a download: "everything after this row". Rows are read in
 * order of (updated_at, id); using both means two rows stamped with the exact
 * same time can never be skipped at a page boundary.
 */
export interface PullCursor {
  updated_at: string;
  id: string;
}

/**
 * A row as uploaded: every column except `updated_at`. The server stamps
 * `updated_at` itself (its column default on insert, its `moddatetime`
 * trigger on update), so the time is always the server's clock. That matters
 * for downloads: if a workout logged offline at 09:00 but uploaded at 11:00
 * kept its 09:00 stamp, another device whose bookmark had already passed
 * 10:00 would never download it.
 */
export type PushRow<T extends SyncedTable> = Omit<RowByTable[T], 'updated_at'>;

/**
 * Everything the sync engine asks of the server: upload rows, and download
 * pages of the user's workouts, their contents, and visible exercises. Each
 * method throws on any failure.
 */
export interface SyncTransport {
  /**
   * Insert-or-update rows on the server by their id. Sending the same rows
   * twice changes nothing but the server's timestamp — this is what makes
   * retries safe.
   */
  upsert<T extends SyncedTable>(tbl: T, rows: readonly PushRow<T>[]): Promise<void>;

  /**
   * One page of the user's own workouts changed after `after` (or from the
   * very beginning when `after` is null), ordered by (updated_at, id).
   */
  pullWorkouts(userId: string, after: PullCursor | null, limit: number): Promise<WorkoutRow[]>;

  /** Every entry belonging to the given workouts (the caller keeps lists short). */
  pullWorkoutExercises(workoutIds: readonly string[]): Promise<WorkoutExerciseRow[]>;

  /** Every set belonging to the given entries (the caller keeps lists short). */
  pullSets(workoutExerciseIds: readonly string[]): Promise<SetRow[]>;

  /**
   * One page of exercises the user can see (the shared library plus their
   * own customs — the server's security rules decide), changed after `after`.
   */
  pullExercises(after: PullCursor | null, limit: number): Promise<ExerciseRow[]>;

  /**
   * One page of the user's own personal records (B13) changed after `after`, ordered by
   * (updated_at, id) — the records another device (or the server's keep-best rule) changed.
   */
  pullPersonalRecords(userId: string, after: PullCursor | null, limit: number): Promise<PersonalRecordRow[]>;

  /**
   * Deletes rows on the server by id (B14). The server's foreign keys take a deleted
   * workout's entries and sets with it (and the personal records citing those sets). An id
   * the server doesn't have is simply nothing to delete — that is what makes a retry safe.
   */
  deleteRows(tbl: SyncedTable, ids: readonly string[]): Promise<void>;

  /**
   * One page of the user's own tombstones (B14) — notes of deleted workouts and personal
   * records — with an id greater than `afterId` (0 = from the beginning), ordered by id.
   */
  pullTombstones(userId: string, afterId: number, limit: number): Promise<TombstoneRow[]>;

  /**
   * The user's settings row (B15), or null if the server has none to show. One row per user:
   * no bookmark, no paging — it is simply read again on every download.
   */
  pullUserSettings(userId: string): Promise<UserSettingsRow | null>;

  /**
   * Saves the user's kg/lb choice on the server (B15). An UPDATE of their existing row, never
   * an insert: the row is created with the account, and the server's security rules allow the
   * phone no inserts. The server stamps `updated_at` itself, as on every upload. If no row
   * matches (only possible for a line left over from a previous account on this phone) the
   * update changes nothing and still counts as done, so it can't block the queue.
   */
  pushUserSettings(userId: string, unit: WeightUnit): Promise<void>;

  /**
   * Asks the server to analyze one of the user's finished workouts (B18) — the
   * `analyze-workout` server function — and returns the analysis row it stored (computed or
   * recomputed from the workout as the server holds it now). Asking twice is harmless: the
   * server keeps exactly one analysis per workout and replaces it. Throws if the server refuses
   * (not found, not finished) or can't be reached.
   */
  requestAnalysis(workoutId: string): Promise<WorkoutAnalysisRow>;

  /**
   * One page of the user's own workout analyses (B18) changed after `after`, ordered by
   * (updated_at, id) — how a second phone, or a reinstalled one, gets every analysis.
   */
  pullWorkoutAnalyses(userId: string, after: PullCursor | null, limit: number): Promise<WorkoutAnalysisRow[]>;
}

/**
 * One deleted row, as the server's `sync_tombstones` table records it (B14): which table,
 * which row, and when. Written by the server's own triggers, read by the user's other devices
 * so they can delete their copies.
 */
export interface TombstoneRow {
  /** Server-assigned and strictly increasing — the download's bookmark. */
  id: number;
  tbl: 'workouts' | 'personal_records';
  row_id: string;
  /** When the row was deleted, by the server's clock. */
  deleted_at: string;
}
