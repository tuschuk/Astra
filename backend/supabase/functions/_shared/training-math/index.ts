/**
 * Astra's training math — the one and only place it lives.
 *
 * Everything that computes an estimated 1RM, an RPE or percentage working weight, a plate
 * breakdown, a kg/lb conversion, a PR or session volume imports it from here. The app reaches this file through
 * the `@training-math` alias (frontend/tsconfig.json, metro.config.js, jest.config.js); server
 * functions import it by relative path from `functions/_shared/`. Copying any of this math
 * somewhere else is a bug.
 *
 * Rules every file here follows so both the phone app and Supabase's Deno runtime can load it:
 * plain TypeScript, imports between files spell out `.ts`, no packages, no I/O, no clock.
 */
export { KG_PER_LB, displayWeight, kgToLb, lbToKg, roundToIncrement } from './units.ts';
export type { WeightUnit } from './units.ts';
export { MAX_EPLEY_REPS, epleyE1rm, weightForReps } from './e1rm.ts';
export {
  MAX_RPE,
  MAX_RPE_REPS,
  MIN_RPE,
  MIN_RPE_REPS,
  percentOfOneRm,
  workingWeightFromRpe,
} from './rpe.ts';
export { MAX_PERCENT, workingWeightFromPercent } from './intensity.ts';
export { loadBar } from './plates.ts';
export type { BarLoad, PlateCount, PlateInventoryItem } from './plates.ts';
export {
  assertValidEntryNotes,
  assertValidExerciseName,
  assertValidProgramName,
  assertValidProgramPosition,
  assertValidProgramTargets,
  assertValidProgramWorkoutName,
  assertValidSetFields,
  assertValidSupersetGroup,
  assertValidTeamName,
  assertValidWorkoutNotes,
  assertValidWorkoutTitle,
  MAX_ENTRY_NOTES_LENGTH,
  MAX_EXERCISE_NAME_LENGTH,
  MAX_PROGRAM_NAME_LENGTH,
  MAX_PROGRAM_WORKOUT_NAME_LENGTH,
  MAX_SET_NOTES_LENGTH,
  MAX_SET_SCORE_LENGTH,
  MAX_TEAM_NAME_LENGTH,
  MAX_WORKOUT_NOTES_LENGTH,
  MAX_WORKOUT_TITLE_LENGTH,
  roundRpeForStorage,
  roundWeightKgForStorage,
} from './limits.ts';
export type { ProgramTargetsToCheck, SetFieldsToCheck } from './limits.ts';
export { beatsRecord, classifyPrs, compareRecordBooks, recordBooks, recordsFromSets } from './prs.ts';
export type { PrCandidateSet, PrEvent, PrKind, PrRecords, RecordBook, RefSet } from './prs.ts';
export { sessionVolumeKg, setVolumeKg } from './volume.ts';
export type { VolumeSet } from './volume.ts';
