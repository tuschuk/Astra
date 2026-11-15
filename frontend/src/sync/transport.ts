/**
 * The sync engine's view of the server: six operations, nothing more.
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
import type {
  ExerciseRow,
  PersonalRecordRow,
  RowByTable,
  SetRow,
  SyncedTable,
  WorkoutExerciseRow,
  WorkoutRow,
} from '@/db/dao';

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
}
