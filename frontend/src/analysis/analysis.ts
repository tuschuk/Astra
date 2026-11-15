/**
 * The post-workout analysis on the phone (B18): reading it, computing it offline, and asking the
 * server to make the stored copy.
 *
 * Where analyses come from: the `analyze-workout` server function is the only thing that writes
 * one (the server table lets no phone write — ANA-11). The phone never computes a *different*
 * analysis: it runs the very same shared rules (`@analysis`) over its own copy of the rows, so
 * while offline the screen can show exactly what the server will store.
 *
 * Four things live here:
 *   - `localAnalysis` — the analysis computed on the phone from its own database (the offline
 *     view);
 *   - `storedAnalysis` — the server's analysis as last downloaded, or null;
 *   - `analysisForScreen` — which of the two the analysis screen shows (the freshness rule);
 *   - `analysisRequestPass` — the sync engine's last step: ask the server to analyze every
 *     finished workout that has no analysis yet, or whose analysis is out of date after an edit.
 *
 * Every query is parameterized and filtered by the signed-in user's id (the device file can still
 * hold a previous account's rows).
 */
import {
  buildAnalysis,
  timestampMs,
  type AnalysisInput,
  type AnalysisPr,
  type WorkoutAnalysis,
} from '@analysis';

import { fromSqlRow, saveServerAnalysesTx, TABLE_COLUMNS, type WorkoutAnalysisRow } from '@/db/dao';
import { placeholders, type SqlDriver, type SqlExecutor } from '@/db/driver';
import type { SyncTransport } from '@/sync/transport';

/**
 * Most analyses one sync asks the server for. A reinstalled phone with a long history (whose
 * analyses haven't downloaded) or a backlog of pre-B18 workouts catches up over a few syncs
 * instead of firing hundreds of requests at once.
 */
export const ANALYSIS_BATCH_LIMIT = 10;

/** An analysis as the screens read it: `new_prs` parsed into a list. */
export type ReadAnalysis = Omit<WorkoutAnalysis, 'new_prs'> & { new_prs: AnalysisPr[] };

/** The analysis-screen view of one workout: what to show, where it came from, and the workout's name parts. */
export interface ScreenAnalysis {
  analysis: ReadAnalysis;
  /** `stored` = the server's row; `local` = computed on the phone just now (offline, or not yet synced). */
  source: 'stored' | 'local';
  workout: { title: string | null; started_at: string };
}

/** Reads a finished workout's rows in the shape the shared rules take, or null if it isn't the user's finished workout. */
async function readAnalysisInput(db: SqlExecutor, userId: string, workoutId: string): Promise<AnalysisInput | null> {
  const workout = await db.getFirstAsync<{
    id: string;
    user_id: string;
    started_at: string;
    ended_at: string | null;
    updated_at: string;
  }>(
    'select id, user_id, started_at, ended_at, updated_at from workouts where id = ? and user_id = ? and ended_at is not null',
    [workoutId, userId],
  );
  if (!workout) return null;
  const entries = await db.getAllAsync<{ id: string; exercise_id: string | null; position: number }>(
    'select id, exercise_id, position from workout_exercises where workout_id = ?',
    [workoutId],
  );
  const rawSets = await db.getAllAsync<{
    id: string;
    workout_exercise_id: string;
    position: number;
    reps: number | null;
    weight_kg: number | null;
    is_warmup: number;
  }>(
    `select s.id, s.workout_exercise_id, s.position, s.reps, s.weight_kg, s.is_warmup
     from sets s join workout_exercises we on we.id = s.workout_exercise_id
     where we.workout_id = ?`,
    [workoutId],
  );
  const sets = rawSets.map((s) => ({ ...s, is_warmup: s.is_warmup === 1 }));
  const records = await recordsCitingSets(db, userId, sets.map((s) => s.id));
  const exerciseIds = [...new Set(entries.map((e) => e.exercise_id).filter((id): id is string => id != null))];
  const exerciseNames: Record<string, string> = {};
  if (exerciseIds.length > 0) {
    const names = await db.getAllAsync<{ id: string; name: string }>(
      `select id, name from exercises where id in (${placeholders(exerciseIds.length)}) and (owner_id is null or owner_id = ?)`,
      [...exerciseIds, userId],
    );
    for (const n of names) exerciseNames[n.id] = n.name;
  }
  return { workout, entries, sets, records, exerciseNames };
}

/** Most ids bound into one local statement (SQLite's bound-value limit is far above this). */
const ID_CHUNK = 500;

/** The user's personal records whose proof is one of `setIds`. */
async function recordsCitingSets(db: SqlExecutor, userId: string, setIds: readonly string[]) {
  const out: AnalysisInput['records'][number][] = [];
  for (let i = 0; i < setIds.length; i += ID_CHUNK) {
    const part = setIds.slice(i, i + ID_CHUNK);
    out.push(
      ...(await db.getAllAsync<AnalysisInput['records'][number]>(
        `select exercise_id, kind, reps, value_kg, source_set_id from personal_records
         where user_id = ? and source_set_id in (${placeholders(part.length)})`,
        [userId, ...part],
      )),
    );
  }
  return out;
}

/**
 * The analysis of one of the user's finished workouts, computed on the phone with the shared
 * rules — identical to what the server function stores for the same rows. Null when the workout
 * isn't on the phone, isn't the user's, or isn't finished.
 */
export async function localAnalysis(db: SqlExecutor, userId: string, workoutId: string): Promise<ReadAnalysis | null> {
  const input = await readAnalysisInput(db, userId, workoutId);
  return input ? buildAnalysis(input) : null;
}

/**
 * Parses a stored row's `new_prs` text into a list. A row whose text is unreadable (never
 * expected — the server's column only holds JSON lists) reads as having no records rather than
 * breaking the screen.
 */
function parsePrs(text: string): AnalysisPr[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as AnalysisPr[]) : [];
  } catch {
    return [];
  }
}

/** The server's analysis of a workout as last downloaded to this phone (the user's only), or null. */
export async function storedAnalysis(db: SqlExecutor, userId: string, workoutId: string): Promise<ReadAnalysis | null> {
  const columns = (TABLE_COLUMNS.workout_analyses as readonly string[]).join(', ');
  const raw = await db.getFirstAsync<Record<string, unknown>>(
    `select ${columns} from workout_analyses where id = ? and user_id = ?`,
    [workoutId, userId],
  );
  if (!raw) return null;
  const { created_at: _created, updated_at: _updated, ...row } = fromSqlRow('workout_analyses', raw);
  return { ...row, new_prs: parsePrs(row.new_prs) };
}

/**
 * Whether anything the analysis of `workoutId` is computed from still has unsent changes on
 * this phone: the workout itself, its slots, its sets, or the personal records citing its sets.
 * A pending change means the server's copy is behind this phone — a fact, needing no clock.
 */
export async function hasPendingInputs(db: SqlExecutor, workoutId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ pending: number }>(
    `select exists (
       select 1 from outbox o where
            (o.tbl = 'workouts' and o.row_id = ?)
         or (o.tbl = 'workout_exercises' and o.row_id in (select id from workout_exercises where workout_id = ?))
         or (o.tbl = 'sets' and o.row_id in (
               select s.id from sets s join workout_exercises we on we.id = s.workout_exercise_id where we.workout_id = ?))
         or (o.tbl = 'personal_records' and o.row_id in (
               select pr.id from personal_records pr
               join sets s on s.id = pr.source_set_id
               join workout_exercises we on we.id = s.workout_exercise_id where we.workout_id = ?))
     ) as pending`,
    [workoutId, workoutId, workoutId, workoutId],
  );
  return (row?.pending ?? 0) === 1;
}

/**
 * True when a stored analysis was computed from an older version of the workout than the one
 * on the phone (`workout_updated_at` before the workout's `updated_at`). Only meaningful once
 * the workout has no unsent changes — then both stamps are the server's, so comparing them is
 * honest whatever the phone's clock says.
 */
function isStale(analysisWorkoutUpdatedAt: string, workoutUpdatedAt: string): boolean {
  return timestampMs(analysisWorkoutUpdatedAt) < timestampMs(workoutUpdatedAt);
}

/**
 * What the analysis screen shows for one workout (the freshness rule, plan G5 / G12):
 *   1. a workout with unsent changes always shows the phone's own computation — the stored row
 *      predates the change (decided by fact, not by comparing clocks);
 *   2. otherwise the stored row, unless it is stale (computed from an older version of the
 *      workout — both stamps are the server's by then);
 *   3. with no stored row (offline, not synced yet, or a workout finished before B18) — the
 *      phone's computation.
 * Since both copies come from the same rules, the screen looks the same either way unless the
 * data actually differs. Null when the workout isn't the user's finished workout on this phone.
 */
export async function analysisForScreen(db: SqlExecutor, userId: string, workoutId: string): Promise<ScreenAnalysis | null> {
  const workout = await db.getFirstAsync<{ title: string | null; started_at: string; updated_at: string }>(
    'select title, started_at, updated_at from workouts where id = ? and user_id = ? and ended_at is not null',
    [workoutId, userId],
  );
  if (!workout) return null;
  const named = { title: workout.title ?? null, started_at: workout.started_at };
  if (!(await hasPendingInputs(db, workoutId))) {
    const stored = await storedAnalysis(db, userId, workoutId);
    if (stored && !isStale(stored.workout_updated_at, workout.updated_at)) {
      return { analysis: stored, source: 'stored', workout: named };
    }
  }
  const local = await localAnalysis(db, userId, workoutId);
  return local ? { analysis: local, source: 'local', workout: named } : null;
}

/**
 * The user's finished workouts that need a server analysis, newest first, at most `limit`:
 * those with no analysis on the phone, or a stale one — skipping any with unsent changes (the
 * server would compute from data this phone has already changed; the next sync, after the
 * upload, asks instead).
 */
export async function workoutsNeedingAnalysis(
  db: SqlExecutor,
  userId: string,
  limit: number = ANALYSIS_BATCH_LIMIT,
): Promise<string[]> {
  const candidates = await db.getAllAsync<{ id: string; updated_at: string; analyzed_from: string | null }>(
    `select w.id, w.updated_at, a.workout_updated_at as analyzed_from
     from workouts w left join workout_analyses a on a.id = w.id
     where w.user_id = ? and w.ended_at is not null
     order by w.started_at desc, w.id desc`,
    [userId],
  );
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= limit) break;
    if (c.analyzed_from != null && !isStale(c.analyzed_from, c.updated_at)) continue;
    if (await hasPendingInputs(db, c.id)) continue;
    out.push(c.id);
  }
  return out;
}

/** What one request pass did, for logging and tests. */
export interface AnalysisPassResult {
  /** Analyses the server returned and the phone saved. */
  saved: number;
  /** Requests that failed (retried by a later sync). */
  failed: number;
}

/**
 * The sync engine's last step after a successful download (ANA-1): asks the server to analyze
 * each workout `workoutsNeedingAnalysis` finds, saving each returned row on the phone straight
 * away (so the screen shows it without waiting for the next download). A failed request is
 * reported to `log` and skipped — the workout is still missing its analysis, so the next sync
 * asks again. Never throws for a single failed request.
 *
 * Runs only after the download succeeded, so every workout without unsent changes holds the
 * server's own `updated_at` — which is what makes the staleness compare honest.
 */
export async function analysisRequestPass(
  db: SqlDriver,
  transport: SyncTransport,
  userId: string,
  log: (message: string, error: unknown) => void = (m, e) => console.warn(m, e),
): Promise<AnalysisPassResult> {
  const result: AnalysisPassResult = { saved: 0, failed: 0 };
  for (const workoutId of await workoutsNeedingAnalysis(db, userId)) {
    let row: WorkoutAnalysisRow;
    try {
      row = await transport.requestAnalysis(workoutId);
    } catch (error) {
      result.failed += 1;
      log('Sync: the workout analysis could not be made; the next sync asks again', error);
      continue;
    }
    // Saved only if it is this user's (never expected otherwise — the server reads as them).
    if (row.user_id !== userId || row.id !== workoutId) continue;
    await db.withTransactionAsync((tx) => saveServerAnalysesTx(tx, [row]));
    result.saved += 1;
  }
  return result;
}
