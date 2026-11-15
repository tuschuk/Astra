/**
 * The real connection between the sync engine and the server, over the
 * Supabase client the app already uses for sign-in.
 *
 * Every request runs as the signed-in user, so the server's row-level
 * security decides what can be read and written: the user can only upload
 * rows they own and only download what they're allowed to see. Nothing here
 * relaxes that.
 *
 * Uploads use Supabase's upsert — "insert, or update the row with this id" —
 * which is what makes a retried upload harmless. Downloads read in
 * (updated_at, id) order after a bookmark (see transport.ts, pull.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { TABLE_COLUMNS, type RowByTable, type SyncedTable } from '@/db/dao';

import type { PullCursor, SyncTransport } from './transport';

/** Throws the request's error, if it had one, as a normal Error. */
function throwIfError(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/**
 * The "after this bookmark" filter: a later timestamp, or the same timestamp
 * with a later id. Values are double-quoted because timestamps contain
 * characters (`:`, `+`) the filter syntax would otherwise misread.
 */
export function afterCursorFilter(cursor: PullCursor): string {
  const ts = `"${cursor.updated_at}"`;
  return `updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${cursor.id})`;
}

/** The column list for a table's select, in the device's column order. */
function columnsOf(tbl: SyncedTable): string {
  return (TABLE_COLUMNS[tbl] as readonly string[]).join(',');
}

/** Builds a `SyncTransport` that talks to Supabase through `client`. */
export function createSupabaseTransport(client: SupabaseClient): SyncTransport {
  /** One page of a table after a cursor, optionally narrowed to one user. */
  async function page<T extends 'workouts' | 'exercises' | 'personal_records'>(
    tbl: T,
    after: PullCursor | null,
    limit: number,
    userId?: string,
  ): Promise<RowByTable[T][]> {
    let query = client.from(tbl).select(columnsOf(tbl));
    if (userId) query = query.eq('user_id', userId);
    if (after) query = query.or(afterCursorFilter(after));
    const { data, error } = await query
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    throwIfError(error, `Download of ${tbl} failed`);
    return (data ?? []) as unknown as RowByTable[T][];
  }

  return {
    async upsert(tbl, rows) {
      if (rows.length === 0) return;
      const { error } = await client.from(tbl).upsert(rows as unknown as Record<string, unknown>[], {
        onConflict: 'id',
      });
      throwIfError(error, `Upload to ${tbl} failed`);
    },

    pullWorkouts: (userId, after, limit) => page('workouts', after, limit, userId),

    pullExercises: (after, limit) => page('exercises', after, limit),

    // numeric(8,3) arrives as a JSON number, exactly like sets.weight_kg.
    pullPersonalRecords: (userId, after, limit) => page('personal_records', after, limit, userId),

    pullWorkoutExercises: (workoutIds) => childrenOf('workout_exercises', 'workout_id', workoutIds),

    pullSets: (workoutExerciseIds) => childrenOf('sets', 'workout_exercise_id', workoutExerciseIds),
  };

  /**
   * Every row of a child table whose parent column is one of `parentIds`.
   * Read in pages of CHILD_PAGE_ROWS ordered by id, because the server caps
   * how many rows one response may hold — without paging, a big batch would
   * be cut short silently and those sets would never reach the device.
   */
  async function childrenOf<T extends 'workout_exercises' | 'sets'>(
    tbl: T,
    parentColumn: string,
    parentIds: readonly string[],
  ): Promise<RowByTable[T][]> {
    if (parentIds.length === 0) return [];
    const rows: RowByTable[T][] = [];
    for (let from = 0; ; from += CHILD_PAGE_ROWS) {
      const { data, error } = await client
        .from(tbl)
        .select(columnsOf(tbl))
        .in(parentColumn, [...parentIds])
        .order('id', { ascending: true })
        .range(from, from + CHILD_PAGE_ROWS - 1);
      throwIfError(error, `Download of ${tbl} failed`);
      const got = (data ?? []) as unknown as RowByTable[T][];
      rows.push(...got);
      if (got.length < CHILD_PAGE_ROWS) return rows;
    }
  }
}

/**
 * Rows per child-table response. Kept under Supabase's default response cap
 * (1000 rows) so a full page always means "there may be more".
 */
export const CHILD_PAGE_ROWS = 500;
