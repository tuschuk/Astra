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
export { assertValidSetFields, roundRpeForStorage, roundWeightKgForStorage } from './limits.ts';
export type { SetFieldsToCheck } from './limits.ts';
export { classifyPrs, recordsFromSets } from './prs.ts';
export type { PrCandidateSet, PrEvent, PrKind, PrRecords } from './prs.ts';
export { sessionVolumeKg, setVolumeKg } from './volume.ts';
export type { VolumeSet } from './volume.ts';
