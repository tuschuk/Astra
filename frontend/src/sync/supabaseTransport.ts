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
 * which is what makes a retried upload harmless; deletes (B14) delete by id,
 * equally harmless to retry. Downloads read in (updated_at, id) order after a
 * bookmark, and tombstones in id order (see transport.ts, pull.ts). The
 * settings row (B15) is the exception to both: it is read whole every time
 * and saved with a plain update (see `pushUserSettings`). Analyses (B18) are never uploaded:
 * the phone asks the `analyze-workout` server function to make one (`requestAnalysis`) and
 * downloads them like any bookmarked table. Posts (B21) are upload-only — one upsert per post —
 * and flairs (B21) download-only, read whole each time. A photo post's picture (B22) is uploaded
 * straight to Storage, streamed from the phone's file (see `uploadPostImage`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  TABLE_COLUMNS,
  type FlairRow,
  type MirroredTable,
  type MirrorRowByTable,
  type ProgramTable,
  type RowByTable,
  type WorkoutAnalysisRow,
} from '@/db/dao';
import { parseUnit, parseVisibility } from '@/db/userSettings';
import type { SupabaseConfig } from '@/lib/supabase';
import { throwIfError } from '@/lib/throwIfError';
import { postImageUploadUrl, uploadFile } from '@/social/postImages';

import { PostAlreadyExistsError, type PullCursor, type SyncTransport, type TombstoneRow } from './transport';

/** Postgres's error code for "duplicate key value violates unique constraint". */
const UNIQUE_VIOLATION = '23505';

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
function columnsOf(tbl: MirroredTable): string {
  return (TABLE_COLUMNS[tbl] as readonly string[]).join(',');
}

/**
 * Turns a `workout_analyses` row as the server sends it into the phone's row shape (B18). The
 * one table whose column types differ between the two: the server's `new_prs` is JSON (it
 * arrives as a list) while the phone keeps it as text, and `total_volume_kg` is a numeric that
 * is made sure to be a number. Done here, once, so no reader has to care.
 */
export function toAnalysisRow(raw: Record<string, unknown>): WorkoutAnalysisRow {
  const prs = raw.new_prs;
  return {
    ...(raw as unknown as WorkoutAnalysisRow),
    total_volume_kg: Number(raw.total_volume_kg),
    new_prs: typeof prs === 'string' ? prs : JSON.stringify(prs ?? []),
  };
}

/** How the photo upload reaches Storage; replaceable in tests (the real one streams the file natively). */
export type UploadFileFn = typeof uploadFile;

/**
 * Builds a `SyncTransport` that talks to Supabase through `client`. `config` (the project's
 * address and publishable key) is needed only by the photo upload (B22), which goes to Storage
 * directly rather than through the client — see `uploadPostImage`.
 */
export function createSupabaseTransport(
  client: SupabaseClient,
  config?: SupabaseConfig,
  upload: UploadFileFn = uploadFile,
): SyncTransport {
  /** One page of a table after a cursor, optionally narrowed to one user. */
  async function page<T extends 'workouts' | 'exercises' | 'personal_records' | 'workout_analyses' | ProgramTable>(
    tbl: T,
    after: PullCursor | null,
    limit: number,
    userId?: string,
  ): Promise<MirrorRowByTable[T][]> {
    let query = client.from(tbl).select(columnsOf(tbl));
    if (userId) query = query.eq('user_id', userId);
    if (after) query = query.or(afterCursorFilter(after));
    const { data, error } = await query
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    throwIfError(error, `Download of ${tbl} failed`);
    return (data ?? []) as unknown as MirrorRowByTable[T][];
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

    // B34: only `programs` has a user column; the children are scoped by the server's
    // author-only security rules, which return the caller's rows and nobody else's.
    // numeric target_weight_kg / target_rpe arrive as JSON numbers, like sets.weight_kg.
    pullProgramRows: (tbl, userId, after, limit) =>
      page(tbl, after, limit, tbl === 'programs' ? userId : undefined) as Promise<RowByTable[typeof tbl][]>,

    pullWorkoutExercises: (workoutIds) => childrenOf('workout_exercises', 'workout_id', workoutIds),

    pullSets: (workoutExerciseIds) => childrenOf('sets', 'workout_exercise_id', workoutExerciseIds),

    async deleteRows(tbl, ids) {
      if (ids.length === 0) return;
      // Row-level security limits this to the user's own rows; an id already gone is no error.
      const { error } = await client.from(tbl).delete().in('id', [...ids]);
      throwIfError(error, `Delete from ${tbl} failed`);
    },

    async pullTombstones(userId, afterId, limit) {
      const { data, error } = await client
        .from('sync_tombstones')
        .select('id,tbl,row_id,deleted_at')
        .eq('user_id', userId)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(limit);
      throwIfError(error, 'Download of deletions failed');
      return (data ?? []) as unknown as TombstoneRow[];
    },

    async pullUserSettings(userId) {
      const { data, error } = await client
        .from('user_settings')
        .select('user_id,unit,progress_pic_visibility,updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      throwIfError(error, 'Download of settings failed');
      if (!data) return null;
      const row = data as { user_id: string; unit: unknown; progress_pic_visibility: unknown; updated_at: string };
      return {
        user_id: row.user_id,
        unit: parseUnit(row.unit),
        progress_pic_visibility: parseVisibility(row.progress_pic_visibility),
        updated_at: row.updated_at,
      };
    },

    async pushUserSettings(userId, fields) {
      // An update, never an upsert: the row exists from signup and the phone may not insert.
      // No updated_at — the server's moddatetime trigger stamps it. Both settable fields go up
      // together: the phone's row is always whole (changes are merged into it first), so this
      // never undoes a setting the lifter didn't touch.
      const { error } = await client
        .from('user_settings')
        .update({ unit: fields.unit, progress_pic_visibility: fields.progress_pic_visibility })
        .eq('user_id', userId);
      throwIfError(error, 'Upload of settings failed');
    },

    async requestAnalysis(workoutId) {
      // `functions.invoke` sends the signed-in user's login token, which the server function
      // both requires (JWT check) and reads with (row-level security).
      const { data, error } = await client.functions.invoke('analyze-workout', { body: { workoutId } });
      throwIfError(error, 'Analysis request failed');
      if (typeof data !== 'object' || data === null) throw new Error('Analysis request failed: empty reply');
      return toAnalysisRow(data as Record<string, unknown>);
    },

    async pullWorkoutAnalyses(userId, after, limit) {
      const rows = await page('workout_analyses', after, limit, userId);
      return rows.map((r) => toAnalysisRow(r as unknown as Record<string, unknown>));
    },

    async pushPost(row) {
      // Upsert on the id, so a retry lands on the same row. The only other unique rule on posts
      // is one-per-workout; its 23505 means another device already posted this workout.
      const { error } = await client.from('posts').upsert({ ...row }, { onConflict: 'id' });
      if (error?.code === UNIQUE_VIOLATION) {
        throw new PostAlreadyExistsError(row.workout_id);
      }
      throwIfError(error, 'Upload of post failed');
    },

    async uploadPostImage(imagePath, localFileUri, mimeType) {
      // Straight to Storage's upload endpoint with the phone's native uploader instead of the
      // client's `storage.upload`: the client would need the whole photo in memory first, while
      // this streams it from the file. `x-upsert: true` makes a retry replace the same file.
      // The bucket's own rules still apply: too big or the wrong format is refused (4xx).
      if (!config) throw new Error('Upload of post photo failed: no Supabase address configured');
      const { data, error } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) throw new Error('Upload of post photo failed: not signed in');
      const reply = await upload(postImageUploadUrl(config.url, imagePath), localFileUri, {
        Authorization: `Bearer ${token}`,
        apikey: config.anonKey,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      });
      if (reply.status < 200 || reply.status >= 300) {
        throw new Error(`Upload of post photo failed: ${reply.status} ${reply.body}`.trim());
      }
    },

    async pullFlairs() {
      const { data, error } = await client
        .from('flairs')
        .select(columnsOf('flairs'))
        .order('position', { ascending: true });
      throwIfError(error, 'Download of flairs failed');
      return (data ?? []) as unknown as FlairRow[];
    },
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
