/**
 * Astra's post-workout analysis rules — the one and only place they live (ANA-11: scripted
 * rules, no AI model).
 *
 * The app reaches this file through the `@analysis` alias (frontend/tsconfig.json,
 * metro.config.js, jest.config.js); the `analyze-workout` server function imports it by relative
 * path. Same constraints as the training-math module beside it: plain TypeScript, imports spell
 * out `.ts`, no packages, no I/O, no clock — so both the phone and Supabase's Deno runtime load it.
 */
export { ANALYSIS_ENGINE_VERSION, buildAnalysis } from './analysis.ts';
export type { WorkoutAnalysis } from './analysis.ts';
export { copyState, NOT_MEDICAL_ADVICE, pickCopy, TREND_AROUND_PERCENT, TREND_AROUND_RPE, trendCopy } from './copy.ts';
export { combineMuscleLoads } from './muscles.ts';
export type { MuscleLoads } from './muscles.ts';
export type { AnalysisCopy, CopyState, TrendCopy, TrendCopyInput, TrendLine, TrendMeasure } from './copy.ts';
export { buildSummary, timestampMs } from './summary.ts';
export type {
  AnalysisEntry,
  AnalysisInput,
  AnalysisPr,
  AnalysisRecord,
  AnalysisSet,
  AnalysisSummary,
  AnalysisWorkout,
  TrendSessionInput,
} from './summary.ts';
export {
  buildTrend,
  sessionMeasures,
  TREND_MIN_MEASURE_SESSIONS,
  TREND_MIN_SESSIONS,
  TREND_SCAN_LIMIT,
  TREND_WINDOW_SESSIONS,
  trendHistory,
} from './trend.ts';
export type { AnalysisTrend, SessionMeasures } from './trend.ts';
