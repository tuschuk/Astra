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
 *     workouts only for the requested user;
 *   - an upload that would lower a personal record keeps the stored best (the
 *     keep-best trigger), but a delete followed by an insert does not (B14);
 *   - deletes cascade like the foreign keys and leave tombstones for deleted
 *     workouts and personal records, like the `record_tombstone` triggers.
 *
 * And it can misbehave on demand:
 *   - `offline = true` — every call fails, like airplane mode;
 *   - `failUpsertsOn(tbl)` — uploads to one table fail;
 *   - `loseNextResponse()` — the next upload is SAVED but the reply is lost,
 *     so the phone thinks it failed and will retry (the classic duplicate trap).
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
import type { PullCursor, PushRow, SyncTransport, TombstoneRow } from '@/sync/transport';

type AnyRow = { id: string; updated_at: string } & Record<string, unknown>;

/** Which column links each child table to its parent, for the foreign-key check. */
const PARENT: { [T in SyncedTable]?: { column: string; table: SyncedTable } } = {
  workout_exercises: { column: 'workout_id', table: 'workouts' },
  sets: { column: 'workout_exercise_id', table: 'workout_exercises' },
  personal_records: { column: 'source_set_id', table: 'sets' },
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
    personal_records: new Map(),
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
    const stored =
      tbl === 'personal_records'
        ? (rows.map((r) => this.keepBest(r as PushRow<'personal_records'>)) as unknown as readonly PushRow<T>[])
        : rows;
    this.seed(tbl, stored);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error('Network request failed (response lost)');
    }
  }

  /**
   * The server's keep-best trigger (…_personal_records.sql): an upload that would LOWER a stored
   * record keeps the stored best, book and proof — and still succeeds (the row is re-stamped).
   */
  private keepBest(row: PushRow<'personal_records'>): PushRow<'personal_records'> {
    const stored = this.tables.personal_records.get(row.id);
    if (!stored || row.value_kg >= stored.value_kg) return row;
    const { updated_at: _stamp, ...kept } = stored;
    return { ...row, ...kept, created_at: row.created_at };
  }

  private page<T extends 'workouts' | 'exercises' | 'personal_records'>(
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

  async pullPersonalRecords(userId: string, after: PullCursor | null, limit: number): Promise<PersonalRecordRow[]> {
    this.guard();
    return this.page('personal_records', after, limit, (r) => r.user_id === userId);
  }

  /** Requests to the child endpoints, to check the engine keeps id lists short. */
  readonly childRequestSizes: number[] = [];

  /** The server's `sync_tombstones` table (B14), in id order. */
  readonly tombstones: TombstoneRow[] = [];
  /** Every delete request received, in order (including failed ones). */
  readonly deleteCalls: { tbl: SyncedTable; ids: string[] }[] = [];
  private nextTombstoneId = 1;

  /**
   * Deletes rows by id, like the real server: the foreign keys cascade (a workout takes its
   * entries, an entry its sets, a set the personal records citing it), and the tombstone
   * triggers record every deleted workout and personal record — cascaded ones included. An
   * id the server doesn't hold is silently nothing to delete.
   */
  async deleteRows(tbl: SyncedTable, ids: readonly string[]): Promise<void> {
    this.deleteCalls.push({ tbl, ids: [...ids] });
    this.guard();
    if (this.failing.has(tbl)) throw new Error(`delete from ${tbl} refused`);
    for (const id of ids) this.deleteCascade(tbl, id);
  }

  /** Removes one row and everything whose foreign key points at it, writing tombstones. */
  private deleteCascade(tbl: SyncedTable, id: string): void {
    const row = this.tables[tbl].get(id) as { user_id?: string } | undefined;
    if (!row) return;
    this.tables[tbl].delete(id);
    if (tbl === 'workouts' || tbl === 'personal_records') {
      const tombstoneId = this.nextTombstoneId++;
      this.tombstones.push({ id: tombstoneId, tbl, row_id: id, deleted_at: this.now() });
      this.tombstoneOwner.set(tombstoneId, row.user_id ?? '');
    }
    for (const [child, link] of Object.entries(PARENT) as [SyncedTable, { column: string; table: SyncedTable }][]) {
      if (link.table !== tbl) continue;
      for (const [childId, childRow] of [...this.tables[child].entries()]) {
        if ((childRow as unknown as Record<string, unknown>)[link.column] === id) this.deleteCascade(child, childId);
      }
    }
  }

  /** Who each tombstone belongs to (the real table's user_id column). */
  private readonly tombstoneOwner = new Map<number, string>();

  /** The user's tombstones after `afterId`, in id order — like the real table's owner-only read. */
  async pullTombstones(userId: string, afterId: number, limit: number): Promise<TombstoneRow[]> {
    this.guard();
    return this.tombstones
      .filter((t) => t.id > afterId && this.tombstoneOwner.get(t.id) === userId)
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

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
