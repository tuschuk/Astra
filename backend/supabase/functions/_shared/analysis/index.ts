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
export { copyState, NOT_MEDICAL_ADVICE, pickCopy } from './copy.ts';
export type { AnalysisCopy, CopyState } from './copy.ts';
export { buildSummary, timestampMs } from './summary.ts';
export type {
  AnalysisEntry,
  AnalysisInput,
  AnalysisPr,
  AnalysisRecord,
  AnalysisSet,
  AnalysisSummary,
  AnalysisWorkout,
} from './summary.ts';
