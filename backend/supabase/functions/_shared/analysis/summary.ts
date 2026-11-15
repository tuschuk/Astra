/**
 * The numbers of a post-workout analysis (ANA-2): total volume, set counts, duration and the
 * personal records the session holds.
 *
 * Why this file exists: the analysis is computed in TWO places — the `analyze-workout` server
 * function (the stored, durable copy) and the phone (the offline view of the same thing). Both
 * hand this file the same rows and get the same answer, so there is one set of rules and no
 * mirrored copy to drift. Every number comes from the one training-math home (`volume.ts` for
 * tonnage, `units.ts` for rounding); nothing is re-derived here.
 *
 * Inputs are plain database rows (the `workouts`, `workout_exercises`, `sets` and
 * `personal_records` columns, snake_case, weights in kg) so neither caller translates anything.
 * Pure logic: no I/O, no clock, no randomness — the same rows always give the same summary.
 * Rules that keep it loadable by Supabase's Deno runtime too: imports spell out `.ts`, no packages.
 */
import { compareRecordBooks, roundToIncrement, sessionVolumeKg, type PrKind } from '../training-math/index.ts';

/** The workout row's columns the analysis reads. Timestamps are ISO-8601 text. */
export interface AnalysisWorkout {
  id: string;
  user_id: string;
  started_at: string;
  /** null while the workout is in progress — such a workout is never analyzed. */
  ended_at: string | null;
  updated_at: string;
}

/** One exercise slot of the workout: which exercise, and where it sits in the workout. */
export interface AnalysisEntry {
  id: string;
  exercise_id: string | null;
  position: number;
}

/** One logged set: what volume and set counts need, plus where it sits in its slot. */
export interface AnalysisSet {
  id: string;
  workout_exercise_id: string;
  position: number;
  reps: number | null;
  weight_kg: number | null;
  is_warmup: boolean;
}

/** One `personal_records` row (a record book's current best and the set that holds it). */
export interface AnalysisRecord {
  exercise_id: string;
  kind: PrKind;
  reps: number | null;
  value_kg: number;
  source_set_id: string;
}

/** Everything one analysis is computed from. */
export interface AnalysisInput {
  workout: AnalysisWorkout;
  entries: readonly AnalysisEntry[];
  sets: readonly AnalysisSet[];
  /**
   * Personal records that may cite this workout's sets. Rows citing any other set are ignored,
   * so a caller may pass a wider list safely.
   */
  records: readonly AnalysisRecord[];
  /** Exercise id → its name, for the exercises in the workout (missing = deleted exercise). */
  exerciseNames: Readonly<Record<string, string>>;
}

/**
 * One personal record the session holds, as stored in the analysis. The exercise NAME is a
 * snapshot taken when the analysis was made, so an old analysis still reads correctly after a
 * custom exercise is deleted (plan decision G3a). The weight stays in kg — screens convert it
 * to the lifter's unit, so no unit is ever frozen into the analysis.
 */
export interface AnalysisPr {
  exercise_id: string;
  exercise_name: string | null;
  kind: PrKind;
  reps: number | null;
  value_kg: number;
}

/** The numbers of one analysis. */
export interface AnalysisSummary {
  /** Reps × weight over the work sets, in kg, rounded to 3 decimals (warm-ups and unloaded sets add 0). */
  total_volume_kg: number;
  /** Every set logged, warm-ups included. */
  total_sets: number;
  /** The sets that were not warm-ups. */
  working_sets: number;
  /** How long the workout took, in whole seconds (never negative). */
  duration_seconds: number;
  /** The record books this workout's sets hold, in workout order. */
  new_prs: AnalysisPr[];
}

/**
 * The volume rounding: the server column is numeric(10,3), so rounding to 3 decimals here
 * means a locally computed number and the stored one can never disagree.
 */
const VOLUME_INCREMENT_KG = 0.001;

/**
 * A database timestamp as milliseconds since 1970 (NaN if unreadable). Postgres sends
 * microseconds ("…:00.123456+00:00"), which not every JavaScript engine parses, so the fraction
 * is trimmed to milliseconds first.
 */
export function timestampMs(timestamp: string): number {
  return Date.parse(timestamp.replace(/(\.\d{3})\d+/, '$1'));
}

/**
 * The workout's sets in the order they were logged: by their slot's position, then the set's
 * own position (ids break ties). Sorting here, rather than trusting each caller's query order,
 * is what makes the server and the phone list PRs in the same order.
 */
function setsInWorkoutOrder(entries: readonly AnalysisEntry[], sets: readonly AnalysisSet[]): AnalysisSet[] {
  const slot = new Map(entries.map((e) => [e.id, e]));
  const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...sets].sort((a, b) => {
    const ea = slot.get(a.workout_exercise_id);
    const eb = slot.get(b.workout_exercise_id);
    return (
      (ea?.position ?? 0) - (eb?.position ?? 0) ||
      compareText(a.workout_exercise_id, b.workout_exercise_id) ||
      a.position - b.position ||
      compareText(a.id, b.id)
    );
  });
}

/**
 * Works out the analysis numbers for one finished workout.
 *
 * Inputs: the workout, its slots and sets, the personal records that may cite its sets, and
 * the exercise names. Only sets belonging to the given slots are counted.
 * Output: the summary — see `AnalysisSummary` for each field's rule.
 *
 * "New PRs" means the record books this workout's sets hold right now (plan decision G3): right
 * after finishing, those are exactly the PRs the session set — the same rows the saved workout's
 * PR badges read. Throws for an unfinished workout (it has no duration and is never analyzed).
 */
export function buildSummary(input: AnalysisInput): AnalysisSummary {
  const { workout, entries, records, exerciseNames } = input;
  if (workout.ended_at == null) throw new Error(`Workout ${workout.id} is not finished`);

  const slotIds = new Set(entries.map((e) => e.id));
  const sets = setsInWorkoutOrder(
    entries,
    input.sets.filter((s) => slotIds.has(s.workout_exercise_id)),
  );

  const volume = sessionVolumeKg(sets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })));
  const durationMs = timestampMs(workout.ended_at) - timestampMs(workout.started_at);

  // Each set's place in the workout, so records are listed in the order their sets were lifted;
  // several books held by one set follow the one record order (`compareRecordBooks`).
  const setOrder = new Map(sets.map((s, index) => [s.id, index]));
  const new_prs = records
    .filter((r) => setOrder.has(r.source_set_id))
    .sort(
      (a, b) =>
        (setOrder.get(a.source_set_id) ?? 0) - (setOrder.get(b.source_set_id) ?? 0) || compareRecordBooks(a, b),
    )
    .map((r) => ({
      exercise_id: r.exercise_id,
      exercise_name: exerciseNames[r.exercise_id] ?? null,
      kind: r.kind,
      reps: r.reps,
      value_kg: r.value_kg,
    }));

  return {
    total_volume_kg: roundToIncrement(volume, VOLUME_INCREMENT_KG),
    total_sets: sets.length,
    working_sets: sets.filter((s) => !s.is_warmup).length,
    duration_seconds: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs / 1000)) : 0,
    new_prs,
  };
}
