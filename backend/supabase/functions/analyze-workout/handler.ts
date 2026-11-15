/**
 * What the `analyze-workout` server function does with one request, separated from the Deno
 * wiring in `index.ts` so it can be tested with fake data (tests never touch the real project).
 *
 * The request: "analyze my workout `workoutId`". The steps:
 *   1. check the request names a workout id at all (400 if not);
 *   2. read the workout AS THE CALLER — `deps` reads through the caller's own login, so the
 *      database's row-level security decides what they can see — and accept it only if the
 *      caller OWNS it (security rules also show other people's public workouts, but never their
 *      records, so analyzing one would save a wrong analysis over the owner's). Not found or not
 *      theirs → 404 (the two look the same on purpose, so nobody can probe for other people's
 *      workouts);
 *   3. refuse a workout still in progress (422) — only finished workouts are analyzed (ANA-1);
 *   4. read its exercise slots, sets, the personal records citing those sets, and the
 *      exercise names, again as the caller;
 *   5. hand all of it to the shared rules (`buildAnalysis`) — this file computes nothing itself;
 *   6. save the result keyed by the workout id (one analysis per workout; a repeat replaces it)
 *      and return the stored row.
 * The owner written onto the analysis comes from the workout row read under the caller's
 * security rules — never from the request — so an analysis can't be planted on someone else.
 *
 * No AI model, no network beyond these reads and the one save (ANA-11).
 */
import {
  buildAnalysis,
  type AnalysisEntry,
  type AnalysisRecord,
  type AnalysisSet,
  type AnalysisWorkout,
  type WorkoutAnalysis,
} from '../_shared/analysis/index.ts';

/** An analysis as stored: the computed analysis plus the table's own timestamps. */
export interface StoredAnalysisRow extends WorkoutAnalysis {
  created_at: string;
  updated_at: string;
}

/**
 * The database access a request needs. The real one (index.ts) reads with the caller's login
 * and saves with the server's own key; tests pass in-memory fakes.
 */
export interface AnalyzeDeps {
  /** The workout, if the caller can see it (their own), else null. */
  readWorkout(workoutId: string): Promise<AnalysisWorkout | null>;
  /** The workout's exercise slots. */
  readEntries(workoutId: string): Promise<AnalysisEntry[]>;
  /** The sets in the given slots. */
  readSets(entryIds: readonly string[]): Promise<AnalysisSet[]>;
  /** The caller's personal records whose proof is one of the given sets. */
  readRecords(setIds: readonly string[]): Promise<AnalysisRecord[]>;
  /** Exercise id → name, for the given exercises the caller can see. */
  readExerciseNames(exerciseIds: readonly string[]): Promise<Record<string, string>>;
  /** Inserts or replaces the analysis keyed by its id, returning the row as stored. */
  saveAnalysis(analysis: WorkoutAnalysis): Promise<StoredAnalysisRow>;
}

/** The function's answer: an HTTP status and a JSON body. */
export type AnalyzeResponse =
  | { status: 200; body: StoredAnalysisRow }
  | { status: 400 | 404 | 422; body: { error: string } };

/** A UUID in its usual text form (any version). Ids are always UUIDs in this database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads `workoutId` out of a request body, or null if it isn't a UUID string. */
export function workoutIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const id = (body as { workoutId?: unknown }).workoutId;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/**
 * Handles one analyze request (see the file comment). `callerId` is the signed-in lifter, as
 * the platform verified their login token. Read or save failures are thrown for the caller
 * (index.ts) to report as a server error.
 */
export async function handleAnalyzeRequest(
  body: unknown,
  callerId: string,
  deps: AnalyzeDeps,
): Promise<AnalyzeResponse> {
  const workoutId = workoutIdOf(body);
  if (!workoutId) return { status: 400, body: { error: 'workoutId must be a workout id' } };

  const workout = await deps.readWorkout(workoutId);
  // Owner only. Row-level security also shows a lifter OTHER people's public (and, to
  // followers, followers-only) workouts — but never their personal records — so analyzing one
  // would save a wrong analysis over its owner's. Answered exactly like "not found".
  if (!workout || workout.user_id !== callerId) return { status: 404, body: { error: 'Workout not found' } };
  if (workout.ended_at == null) {
    return { status: 422, body: { error: 'Only finished workouts are analyzed' } };
  }

  const entries = await deps.readEntries(workout.id);
  const sets = await deps.readSets(entries.map((e) => e.id));
  const records = await deps.readRecords(sets.map((s) => s.id));
  const exerciseIds = [...new Set(entries.map((e) => e.exercise_id).filter((id): id is string => id != null))];
  const exerciseNames = await deps.readExerciseNames(exerciseIds);

  const analysis = buildAnalysis({ workout, entries, sets, records, exerciseNames });
  return { status: 200, body: await deps.saveAnalysis(analysis) };
}
