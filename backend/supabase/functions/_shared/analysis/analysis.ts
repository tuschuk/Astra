/**
 * One call that turns a finished workout's rows into its complete analysis: the numbers
 * (`summary.ts`), the words (`copy.ts`) and the rules version. The `analyze-workout` server
 * function stores exactly this; the phone shows exactly this while offline. Same rows in, same
 * analysis out — on either runtime.
 */
import { pickCopy } from './copy.ts';
import { buildSummary, type AnalysisInput, type AnalysisSummary } from './summary.ts';
import { buildTrend, type AnalysisTrend } from './trend.ts';

/**
 * Which version of the rules produced an analysis, stored on every row. Raise it whenever a
 * rule or a string changes, so an old row can be told apart from (and recomputed by) the new
 * rules — the phone re-requests, and prefers its own computation over, any stored row made by an
 * older version (`frontend/src/analysis/analysis.ts`).
 * Version 1: B18's summary + four-state copy. Version 2: B42's trend fields (`trend.ts`).
 */
export const ANALYSIS_ENGINE_VERSION = 2;

/**
 * A complete analysis, column for column as the `workout_analyses` table stores it (minus the
 * table's own `created_at` / `updated_at`). `id` is the workout's id — one analysis per workout.
 */
export interface WorkoutAnalysis extends AnalysisSummary, AnalysisTrend {
  id: string;
  user_id: string;
  engine_version: number;
  headline: string;
  message: string;
  /** The workout's `updated_at` these numbers were computed from — how a stale analysis is spotted. */
  workout_updated_at: string;
}

/**
 * Builds the analysis of one finished workout from its rows (see `AnalysisInput`). Throws for
 * an unfinished workout. Deterministic: no clock, no randomness, no network, no model.
 */
export function buildAnalysis(input: AnalysisInput): WorkoutAnalysis {
  const summary = buildSummary(input);
  const { headline, message } = pickCopy(summary);
  return {
    id: input.workout.id,
    user_id: input.workout.user_id,
    engine_version: ANALYSIS_ENGINE_VERSION,
    total_volume_kg: summary.total_volume_kg,
    total_sets: summary.total_sets,
    working_sets: summary.working_sets,
    duration_seconds: summary.duration_seconds,
    new_prs: summary.new_prs,
    headline,
    message,
    workout_updated_at: input.workout.updated_at,
    ...buildTrend(input),
  };
}
