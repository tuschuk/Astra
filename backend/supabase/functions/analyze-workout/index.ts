/**
 * `analyze-workout` — the Supabase server function that writes a finished workout's
 * post-workout analysis (ANA-1, ANA-2, ANA-11).
 *
 * Called by the phone right after a sync uploads a finished workout:
 *   POST /functions/v1/analyze-workout   { "workoutId": "<uuid>" }
 * with the signed-in lifter's login token (the app's `functions.invoke` sends it). The
 * platform's JWT check is on, so a request without a valid login never reaches this code.
 *
 * This file is only wiring — the decisions are in `handler.ts` and the rules in
 * `_shared/analysis`. It builds two database clients per request:
 *   - one that acts AS THE CALLER (their token), used to learn who they are and for every
 *     read, so row-level security limits what it can see (the handler then accepts only the
 *     caller's OWN workout);
 *   - one with the server's own key, used for exactly one statement: saving the analysis. The
 *     `workout_analyses` table lets no app user write to it at all (see its migration), so this
 *     function is the only thing that can create an analysis.
 * Answers: 200 with the stored row; 400 / 404 / 422 with `{ error }` (see handler.ts); 405 for
 * anything but POST; 500 if the database fails (the phone simply asks again on a later sync).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handleAnalyzeRequest, type AnalyzeDeps, type StoredAnalysisRow } from './handler.ts';
import type { AnalysisEntry, AnalysisRecord, AnalysisSet, AnalysisWorkout } from '../_shared/analysis/index.ts';

/** Most ids in one `in (…)` filter, so a request URL never grows too long. */
const ID_CHUNK = 100;
/** Rows per page of a read — under the API's 1000-row response cap, so a full page means "maybe more". */
const PAGE_ROWS = 500;

/** The columns of `workout_analyses` returned after a save, in table order. */
const ANALYSIS_COLUMNS =
  'id,user_id,engine_version,total_volume_kg,total_sets,working_sets,duration_seconds,new_prs,' +
  'headline,message,workout_updated_at,created_at,updated_at';

/** A JSON response with the given status. */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Throws a database error as a normal Error, naming what was being done. */
function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Splits a list into pieces of at most `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Every row of `table` whose `column` is one of `values`, read in id-ordered pages and
 * id-chunked requests so neither a long id list nor the response cap can cut rows off.
 */
async function selectIn<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  values: readonly string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunk(values, ID_CHUNK)) {
    for (let from = 0; ; from += PAGE_ROWS) {
      const { data, error } = await client
        .from(table)
        .select(columns)
        .in(column, part)
        .order('id', { ascending: true })
        .range(from, from + PAGE_ROWS - 1);
      check(error, `Reading ${table} failed`);
      const got = (data ?? []) as unknown as T[];
      rows.push(...got);
      if (got.length < PAGE_ROWS) break;
    }
  }
  return rows;
}

/** The real database access: reads as the caller (`asCaller`), saves with the server key (`asServer`). */
function supabaseDeps(asCaller: SupabaseClient, asServer: SupabaseClient): AnalyzeDeps {
  return {
    async readWorkout(workoutId) {
      const { data, error } = await asCaller
        .from('workouts')
        .select('id,user_id,started_at,ended_at,updated_at')
        .eq('id', workoutId)
        .maybeSingle();
      check(error, 'Reading the workout failed');
      return (data as AnalysisWorkout | null) ?? null;
    },
    readEntries: (workoutId) =>
      selectIn<AnalysisEntry>(asCaller, 'workout_exercises', 'id,exercise_id,position', 'workout_id', [workoutId]),
    readSets: (entryIds) =>
      selectIn<AnalysisSet>(
        asCaller,
        'sets',
        'id,workout_exercise_id,position,reps,weight_kg,is_warmup',
        'workout_exercise_id',
        entryIds,
      ),
    readRecords: (setIds) =>
      selectIn<AnalysisRecord>(
        asCaller,
        'personal_records',
        'id,exercise_id,kind,reps,value_kg,source_set_id',
        'source_set_id',
        setIds,
      ),
    async readExerciseNames(exerciseIds) {
      const rows = await selectIn<{ id: string; name: string }>(asCaller, 'exercises', 'id,name', 'id', exerciseIds);
      return Object.fromEntries(rows.map((r) => [r.id, r.name]));
    },
    async saveAnalysis(analysis) {
      // Insert, or replace the workout's one analysis. created_at is left to its default on
      // insert and untouched on replace; the table's trigger stamps updated_at.
      const { data, error } = await asServer
        .from('workout_analyses')
        .upsert(analysis, { onConflict: 'id' })
        .select(ANALYSIS_COLUMNS)
        .single();
      check(error, 'Saving the analysis failed');
      return data as unknown as StoredAnalysisRow;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { error: 'Sign in first' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'The request body must be JSON' });
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    ...noSession,
    global: { headers: { Authorization: authorization } },
  });
  const asServer = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', noSession);

  try {
    // Who is calling: the user the login token belongs to (checked with the auth server).
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: who, error: whoError } = await asCaller.auth.getUser(token);
    if (whoError || !who.user) return json(401, { error: 'Sign in first' });

    const result = await handleAnalyzeRequest(body, who.user.id, supabaseDeps(asCaller, asServer));
    return json(result.status, result.body);
  } catch (error) {
    console.error('analyze-workout failed', error);
    return json(500, { error: 'The analysis could not be made right now' });
  }
});
