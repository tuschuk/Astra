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
 *     workouts and personal records, like the `record_tombstone` triggers;
 *   - the settings row (B15) can only be updated by the phone, never created;
 *   - analyses (B18) are made only by `requestAnalysis` — which runs the real server
 *     function's handler — one per workout, only for its owner, and deleted with their workout;
 *     its history read (B42) mirrors the real one: own finished workouts starting no later, newest
 *     first, capped at `TREND_SCAN_LIMIT`;
 *   - flairs (B21) are the four rows the real migration seeds; posts (B21) are one per workout,
 *     only about the poster's own workout already on the server, and deleted with it;
 *   - photo posts (B22) name a photo in their author's folder and no workout, progress pics are
 *     private, and the `post-images` bucket replaces an object uploaded to the same path again;
 *   - program rows (B34) need their parent row (the foreign keys) and are read back only by
 *     their program's author (the author-only security rules);
 *   - program runs (B35) need their program and are read back only by their owner, and a workout
 *     naming a program workout needs that program workout (the nullable foreign key).
 *
 * And it can misbehave on demand:
 *   - `offline = true` — every call fails, like airplane mode;
 *   - `failUpsertsOn(tbl)` — uploads to one table fail;
 *   - `failPosts` / `failImageUploads` — post rows / post photos are refused;
 *   - `loseNextResponse()` — the next upload is SAVED but the reply is lost,
 *     so the phone thinks it failed and will retry (the classic duplicate trap).
 */
import { timestampMs, TREND_SCAN_LIMIT } from '@analysis';
import type { WeightUnit } from '@training-math';

// The real server function's request logic, so app tests run it end to end.
import { handleAnalyzeRequest, type AnalyzeDeps } from '../../../backend/supabase/functions/analyze-workout/handler.ts';

import type {
  ExerciseRow,
  FlairRow,
  PersonalRecordRow,
  PostRow,
  ProgramRunRow,
  ProgramTable,
  RowByTable,
  SetRow,
  SyncedTable,
  WorkoutAnalysisRow,
  WorkoutExerciseRow,
  WorkoutRow,
  WorkoutVisibility,
} from '@/db/dao';
import type { UserSettingsFields, UserSettingsRow } from '@/db/userSettings';
import {
  PostAlreadyExistsError,
  type PostPushRow,
  type PullCursor,
  type PushRow,
  type SyncTransport,
  type TombstoneRow,
} from '@/sync/transport';

type AnyRow = { id: string; updated_at: string } & Record<string, unknown>;

/** Which column links each child table to its parent, for the foreign-key check. */
const PARENT: { [T in SyncedTable]?: { column: string; table: SyncedTable } } = {
  workout_exercises: { column: 'workout_id', table: 'workouts' },
  sets: { column: 'workout_exercise_id', table: 'workout_exercises' },
  personal_records: { column: 'source_set_id', table: 'sets' },
  program_weeks: { column: 'program_id', table: 'programs' },
  program_workouts: { column: 'program_week_id', table: 'program_weeks' },
  program_exercises: { column: 'program_workout_id', table: 'program_workouts' },
  program_runs: { column: 'program_id', table: 'programs' },
};

/**
 * Nullable links checked like foreign keys only when set (B35): a workout started from a program
 * names its program workout. Not cascaded on delete (the real column is `on delete set null`, and
 * program rows are never hard-deleted by the phone).
 */
const OPTIONAL_REF: { [T in SyncedTable]?: { column: string; table: SyncedTable } } = {
  workouts: { column: 'program_workout_id', table: 'program_workouts' },
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
    programs: new Map(),
    program_weeks: new Map(),
    program_workouts: new Map(),
    program_exercises: new Map(),
    program_runs: new Map(),
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
    const ref = OPTIONAL_REF[tbl];
    if (ref) {
      for (const row of rows) {
        const refId = (row as Record<string, unknown>)[ref.column] as string | null | undefined;
        if (refId != null && !this.tables[ref.table].has(refId)) {
          throw new Error(`insert into ${tbl} violates foreign key ${ref.column}`);
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

  /**
   * Who authored the program a program row belongs to (B34), walking up the tree — the fake's
   * stand-in for the real `private.owns_program` chain. Undefined if any link is missing.
   */
  programOwner(tbl: ProgramTable, row: Record<string, unknown>): string | undefined {
    const t = this.tables;
    if (tbl === 'programs') return row.user_id as string;
    if (tbl === 'program_weeks') return t.programs.get(row.program_id as string)?.user_id;
    if (tbl === 'program_workouts') {
      const week = t.program_weeks.get(row.program_week_id as string);
      return week ? this.programOwner('program_weeks', week as unknown as Record<string, unknown>) : undefined;
    }
    const workout = t.program_workouts.get(row.program_workout_id as string);
    return workout ? this.programOwner('program_workouts', workout as unknown as Record<string, unknown>) : undefined;
  }

  /**
   * One page of a program table (B34), like the real author-only security rules: only rows of
   * programs `userId` wrote come back, in (updated_at, id) order after the bookmark.
   */
  async pullProgramRows<T extends ProgramTable>(
    tbl: T,
    userId: string,
    after: PullCursor | null,
    limit: number,
  ): Promise<RowByTable[T][]> {
    this.guard();
    return this.page(tbl, after, limit, (row) => this.programOwner(tbl, row as unknown as Record<string, unknown>) === userId);
  }

  /** One page of the user's own program runs (B35), like the real owner-only security rules. */
  async pullProgramRuns(userId: string, after: PullCursor | null, limit: number): Promise<ProgramRunRow[]> {
    this.guard();
    return this.page('program_runs', after, limit, (r) => r.user_id === userId);
  }

  private page<T extends 'workouts' | 'exercises' | 'personal_records' | ProgramTable | 'program_runs'>(
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
    // The analysis's foreign key cascades from its workout (B18); analyses leave no tombstone.
    if (tbl === 'workouts') this.analyses.delete(id);
    // So does its post (B21), like the real `posts.workout_id … on delete cascade`.
    if (tbl === 'workouts') {
      for (const [postId, post] of [...this.posts.entries()]) if (post.workout_id === id) this.posts.delete(postId);
    }
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

  /**
   * The server's `user_settings` table (B15): user id → row. Empty until a test seeds it —
   * the real one gets its row from the signup trigger (`seedUserSettings` plays that part).
   */
  readonly userSettings = new Map<string, UserSettingsRow>();
  /** Every settings update received, in order (including failed ones). */
  readonly userSettingsPushes: ({ userId: string } & UserSettingsFields)[] = [];

  /**
   * Creates or changes a user's settings row directly (the signup trigger, or another device).
   * The progress-pic choice (B26) defaults to 'private', the server column's default.
   */
  seedUserSettings(userId: string, unit: WeightUnit, progressPicVisibility: WorkoutVisibility = 'private'): void {
    this.userSettings.set(userId, {
      user_id: userId,
      unit,
      progress_pic_visibility: progressPicVisibility,
      updated_at: this.now(),
    });
  }

  async pullUserSettings(userId: string): Promise<UserSettingsRow | null> {
    this.guard();
    const row = this.userSettings.get(userId);
    return row ? { ...row } : null;
  }

  /**
   * Like the real `update … where user_id = …`: changes an existing row (re-stamping it by the
   * server clock) and silently changes nothing when the user has no row — never inserts.
   */
  async pushUserSettings(userId: string, fields: UserSettingsFields): Promise<void> {
    this.userSettingsPushes.push({ userId, ...fields });
    this.guard();
    if (this.userSettings.has(userId)) this.seedUserSettings(userId, fields.unit, fields.progress_pic_visibility);
  }

  /** The server's `workout_analyses` table (B18): workout id → row. */
  readonly analyses = new Map<string, WorkoutAnalysisRow>();
  /** Every analysis request received, by workout id, in order (including failed ones). */
  readonly analysisRequests: string[] = [];
  /** When true, analysis requests fail (the server function erroring) while the rest works. */
  failAnalyses = false;

  /**
   * Who is calling the analysis function. Null (the default) means "the owner of whichever
   * workout is asked about" — the fake has no logins, and tests seed one user's data. Set it to
   * play another signed-in user.
   */
  callerId: string | null = null;

  /**
   * The `analyze-workout` server function: runs the REAL request handler
   * (`analyze-workout/handler.ts`, with the shared rules inside) against this server's tables,
   * then turns its answer into what the phone receives — the stored row (its `new_prs` as
   * text, like the real transport delivers it), or a thrown error for a 4xx. Saving upserts the
   * one row per workout, keeping `created_at` on a repeat and stamping `updated_at` from the
   * server clock.
   */
  async requestAnalysis(workoutId: string): Promise<WorkoutAnalysisRow> {
    this.analysisRequests.push(workoutId);
    this.guard();
    if (this.failAnalyses) throw new Error('Analysis request failed: 500');
    const caller = this.callerId ?? this.tables.workouts.get(workoutId)?.user_id ?? '';
    const response = await handleAnalyzeRequest({ workoutId }, caller, this.analyzeDeps());
    if (response.status !== 200) throw new Error(`Analysis request failed: ${response.status} ${response.body.error}`);
    return { ...response.body, new_prs: JSON.stringify(response.body.new_prs) };
  }

  /** The server function's database access, over this fake's tables (the caller's RLS view). */
  private analyzeDeps(): AnalyzeDeps {
    const t = this.tables;
    return {
      readWorkout: async (id) => t.workouts.get(id) ?? null,
      readEntries: async (id) => [...t.workout_exercises.values()].filter((e) => e.workout_id === id),
      readSets: async (ids) => [...t.sets.values()].filter((s) => ids.includes(s.workout_exercise_id)),
      readRecords: async (ids) => [...t.personal_records.values()].filter((r) => ids.includes(r.source_set_id)),
      readExerciseNames: async (ids) =>
        Object.fromEntries(ids.flatMap((id) => (t.exercises.has(id) ? [[id, t.exercises.get(id)!.name]] : []))),
      // Like the real read (B42): the owner's other finished workouts starting no later than
      // this one, newest first (by instant, then id), capped, each with all its sets.
      readHistory: async (w) => {
        const at = timestampMs(w.started_at);
        return [...t.workouts.values()]
          .filter((c) => c.user_id === w.user_id && c.ended_at != null && c.id !== w.id && timestampMs(c.started_at) <= at)
          .sort((a, b) => timestampMs(b.started_at) - timestampMs(a.started_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
          .slice(0, TREND_SCAN_LIMIT)
          .map((c) => {
            const slots = new Set([...t.workout_exercises.values()].filter((e) => e.workout_id === c.id).map((e) => e.id));
            return { id: c.id, started_at: c.started_at, sets: [...t.sets.values()].filter((s) => slots.has(s.workout_exercise_id)) };
          });
      },
      saveAnalysis: async (analysis) => {
        const now = this.now();
        const created = this.analyses.get(analysis.id)?.created_at ?? now;
        this.analyses.set(analysis.id, {
          ...analysis,
          new_prs: JSON.stringify(analysis.new_prs),
          created_at: created,
          updated_at: now,
        });
        return { ...analysis, created_at: created, updated_at: now };
      },
    };
  }

  async pullWorkoutAnalyses(userId: string, after: PullCursor | null, limit: number): Promise<WorkoutAnalysisRow[]> {
    this.guard();
    return ([...this.analyses.values()] as unknown as AnyRow[])
      .filter((r) => r.user_id === userId && isAfter(r, after))
      .sort(byCursorOrder)
      .slice(0, limit)
      .map((r) => ({ ...r })) as unknown as WorkoutAnalysisRow[];
  }

  /**
   * The server's `flairs` table (B20), seeded with the same four rows as the real migration.
   * Tests may change it (a new flair is a data change — SOC-3).
   */
  readonly flairs: FlairRow[] = [
    { id: 'wod', name: 'WOD', position: 1, upvotes_only: false },
    { id: 'physique-check', name: 'Physique Check', position: 2, upvotes_only: true },
    { id: 'new-pr', name: 'New PR', position: 3, upvotes_only: false },
    { id: 'form-check', name: 'Form Check', position: 4, upvotes_only: false },
  ];
  /** When true, flair downloads fail while everything else works. */
  failFlairs = false;

  async pullFlairs(): Promise<FlairRow[]> {
    this.guard();
    if (this.failFlairs) throw new Error('Download of flairs failed: 500');
    return [...this.flairs].sort((a, b) => a.position - b.position).map((f) => ({ ...f }));
  }

  /** The server's `posts` table (B20): post id → row. */
  readonly posts = new Map<string, PostRow>();
  /** Every post upload received, by post id, in order (including failed ones). */
  readonly postPushes: string[] = [];
  /** When true, post uploads are refused (a plain error) while everything else works. */
  failPosts = false;

  /**
   * Like the real upsert on `posts`: insert, or update the row with this id (re-stamped by the
   * server clock). Enforced like the real table: the workout must be on the server and belong to
   * the poster (the `owns_workout` security rule and the foreign key), the flair must exist, and a
   * second post for the same workout under a different id is the 23505 unique violation — thrown
   * as `PostAlreadyExistsError`, exactly as the real transport maps it.
   */
  async pushPost(row: PostPushRow): Promise<void> {
    this.postPushes.push(row.id);
    this.requestLog.push(`post:${row.id}`);
    this.guard();
    if (this.failPosts) throw new Error('Upload of post failed: refused');
    if ('updated_at' in row) throw new Error('client must not send updated_at');
    if (row.kind === 'workout') {
      const workout = row.workout_id ? this.tables.workouts.get(row.workout_id) : undefined;
      if (!workout || workout.user_id !== row.user_id || row.image_path !== null) {
        throw new Error('Upload of post failed: new row violates row-level security policy for table "posts"');
      }
    } else {
      // The B22 rules: an image post names a photo in its author's own folder and no workout.
      // (B22's "a progress pic is private" CHECK was dropped at B26 — the lifter chooses.)
      if (row.workout_id !== null || !row.image_path) {
        throw new Error('Upload of post failed: violates check constraint "posts_kind_shape"');
      }
      if (!row.image_path.startsWith(`${row.user_id}/`)) {
        throw new Error('Upload of post failed: violates check constraint "posts_image_in_own_folder"');
      }
    }
    if (!this.flairs.some((f) => f.id === row.flair_id)) {
      throw new Error('Upload of post failed: violates foreign key constraint "posts_flair_id_fkey"');
    }
    for (const other of this.posts.values()) {
      if (row.workout_id !== null && other.workout_id === row.workout_id && other.id !== row.id) {
        throw new PostAlreadyExistsError(row.workout_id);
      }
    }
    this.posts.set(row.id, { ...this.posts.get(row.id), ...row, updated_at: this.now() });
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error('Network request failed (response lost)');
    }
  }

  /**
   * The server's `post-images` bucket (B22): object path → what was uploaded (which phone file,
   * which format). An upload to a path already there replaces it, like `x-upsert: true`.
   */
  readonly objects = new Map<string, { fileUri: string; mimeType: string }>();
  /** Every photo upload received, by path, in order (including failed ones). */
  readonly imageUploads: string[] = [];
  /** Photo uploads and post uploads in the order they arrived ("image:<path>", "post:<id>"). */
  readonly requestLog: string[] = [];
  /** When true, photo uploads are refused (e.g. the bucket's size limit) while everything else works. */
  failImageUploads = false;

  /**
   * Like Storage's upload with `x-upsert: true`: stores (or replaces) the object at `imagePath`.
   * Enforced like the real bucket's rules: the path's first folder must be a user id (owner-only
   * uploads; the fake has no logins, so it checks the shape) and the format must be allowed.
   */
  async uploadPostImage(imagePath: string, localFileUri: string, mimeType: string): Promise<void> {
    this.imageUploads.push(imagePath);
    this.requestLog.push(`image:${imagePath}`);
    this.guard();
    if (this.failImageUploads) throw new Error('Upload of post photo failed: 413 Payload too large');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw new Error('Upload of post photo failed: 415 mime type not supported');
    }
    if (!imagePath.includes('/')) throw new Error('Upload of post photo failed: 403 row-level security');
    this.objects.set(imagePath, { fileUri: localFileUri, mimeType });
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error('Network request failed (response lost)');
    }
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
