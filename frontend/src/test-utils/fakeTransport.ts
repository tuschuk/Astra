/**
 * An in-memory stand-in for the Supabase server, for sync tests.
 *
 * It behaves like the real server in the ways the sync engine relies on:
 *   - rows are stored by id, and an upload of an existing id updates that row
 *     (so duplicates are impossible exactly when they're impossible for real);
 *   - the server stamps `updated_at` from its own ever-increasing clock on
 *     every insert and update (like the column default and `moddatetime`);
 *   - a child row whose parent isn't there is refused (like the foreign keys);
 *   - downloads come back in (updated_at, id) order after a bookmark, and
 *     workouts only for the requested user.
 *
 * And it can misbehave on demand:
 *   - `offline = true` — every call fails, like airplane mode;
 *   - `failUpsertsOn(tbl)` — uploads to one table fail;
 *   - `loseNextResponse()` — the next upload is SAVED but the reply is lost,
 *     so the phone thinks it failed and will retry (the classic duplicate trap).
 */
import type { ExerciseRow, RowByTable, SetRow, SyncedTable, WorkoutExerciseRow, WorkoutRow } from '@/db/dao';
import type { PullCursor, PushRow, SyncTransport } from '@/sync/transport';

type AnyRow = { id: string; updated_at: string } & Record<string, unknown>;

/** Which column links each child table to its parent, for the foreign-key check. */
const PARENT: { [T in SyncedTable]?: { column: string; table: SyncedTable } } = {
  workout_exercises: { column: 'workout_id', table: 'workouts' },
  sets: { column: 'workout_exercise_id', table: 'workout_exercises' },
};

/** True if row `r` comes after bookmark `c` in (updated_at, id) order. */
function isAfter(r: { updated_at: string; id: string }, c: PullCursor | null): boolean {
  if (!c) return true;
  return r.updated_at > c.updated_at || (r.updated_at === c.updated_at && r.id > c.id);
}

function byCursorOrder(a: AnyRow, b: AnyRow): number {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class FakeServer implements SyncTransport {
  /** The server's tables: id → row. */
  readonly tables: { [T in SyncedTable]: Map<string, RowByTable[T]> } = {
    exercises: new Map(),
    workouts: new Map(),
    workout_exercises: new Map(),
    sets: new Map(),
  };
  /** Every upload request received, in order (including failed ones). */
  readonly upsertCalls: { tbl: SyncedTable; ids: string[] }[] = [];
  offline = false;
  private failing = new Set<SyncedTable>();
  private loseResponse = false;
  private clockMs = Date.parse('2026-11-14T12:00:00.000Z');

  /** The server clock: strictly increasing, one millisecond per stamp. */
  now(): string {
    this.clockMs += 1;
    return new Date(this.clockMs).toISOString();
  }

  /** Makes uploads to `tbl` fail until `healUpserts()` is called. */
  failUpsertsOn(tbl: SyncedTable): void {
    this.failing.add(tbl);
  }

  healUpserts(): void {
    this.failing.clear();
  }

  /** The next upload is stored, then reported to the phone as a failure. */
  loseNextResponse(): void {
    this.loseResponse = true;
  }

  /** Puts rows straight onto the server (as if another device had uploaded them). */
  seed<T extends SyncedTable>(tbl: T, rows: readonly Omit<RowByTable[T], 'updated_at'>[]): void {
    for (const row of rows) {
      const existing = this.tables[tbl].get(row.id);
      this.tables[tbl].set(row.id, { ...existing, ...row, updated_at: this.now() } as RowByTable[T]);
    }
  }

  private guard(): void {
    if (this.offline) throw new Error('Network request failed');
  }

  async upsert<T extends SyncedTable>(tbl: T, rows: readonly PushRow<T>[]): Promise<void> {
    this.upsertCalls.push({ tbl, ids: rows.map((r) => r.id) });
    this.guard();
    if (this.failing.has(tbl)) throw new Error(`upsert into ${tbl} refused`);
    const parent = PARENT[tbl];
    if (parent) {
      for (const row of rows) {
        const parentId = (row as Record<string, unknown>)[parent.column] as string;
        if (!this.tables[parent.table].has(parentId)) {
          throw new Error(`insert into ${tbl} violates foreign key ${parent.column}`);
        }
      }
    }
    if (rows.some((r) => 'updated_at' in r)) throw new Error('client must not send updated_at');
    this.seed(tbl, rows);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error('Network request failed (response lost)');
    }
  }

  private page<T extends 'workouts' | 'exercises'>(
    tbl: T,
    after: PullCursor | null,
    limit: number,
    filter: (row: RowByTable[T]) => boolean,
  ): RowByTable[T][] {
    const rows = [...this.tables[tbl].values()] as unknown as AnyRow[];
    return (rows
      .filter((r) => filter(r as unknown as RowByTable[T]) && isAfter(r, after))
      .sort(byCursorOrder)
      .slice(0, limit)
      .map((r) => ({ ...r })) as unknown) as RowByTable[T][];
  }

  async pullWorkouts(userId: string, after: PullCursor | null, limit: number): Promise<WorkoutRow[]> {
    this.guard();
    return this.page('workouts', after, limit, (w) => w.user_id === userId);
  }

  async pullExercises(after: PullCursor | null, limit: number): Promise<ExerciseRow[]> {
    this.guard();
    return this.page('exercises', after, limit, () => true);
  }

  /** Requests to the child endpoints, to check the engine keeps id lists short. */
  readonly childRequestSizes: number[] = [];

  async pullWorkoutExercises(workoutIds: readonly string[]): Promise<WorkoutExerciseRow[]> {
    this.guard();
    this.childRequestSizes.push(workoutIds.length);
    const wanted = new Set(workoutIds);
    return [...this.tables.workout_exercises.values()].filter((e) => wanted.has(e.workout_id)).map((e) => ({ ...e }));
  }

  async pullSets(workoutExerciseIds: readonly string[]): Promise<SetRow[]> {
    this.guard();
    this.childRequestSizes.push(workoutExerciseIds.length);
    const wanted = new Set(workoutExerciseIds);
    return [...this.tables.sets.values()].filter((s) => wanted.has(s.workout_exercise_id)).map((s) => ({ ...s }));
  }
}
