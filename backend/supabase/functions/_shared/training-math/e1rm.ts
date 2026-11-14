/**
 * Estimated one-rep max (e1RM) using the Epley formula: weight × (1 + reps ÷ 30).
 *
 * Why this exists: a lifter who does 100 kg for 5 reps can probably lift about 116.7 kg once.
 * That estimate lets Astra compare sets with different rep counts, catch estimated-1RM PRs, and
 * work backwards to suggest weights in the RPE and %1RM calculators. The Epley expression lives
 * here and nowhere else in the repo — every other calculation calls these functions.
 *
 * All weights are kilograms. The answers are estimates (Epley, 1985), not guarantees.
 */
import { assertFinite, assertPositive, assertWholeInRange } from './validate.ts';

/** Highest rep count the Epley estimate is trusted for; past ~30 reps it stops meaning much. */
export const MAX_EPLEY_REPS = 30;

/**
 * How many times heavier a lifter's 1RM is than a weight they can move for `reps` reps.
 * Example: 5 reps → 1.1667. One rep → exactly 1, because a single you actually lifted *is* your
 * 1RM; raw Epley would claim a 100 kg single "estimates" 103.3 kg, a weight never lifted.
 *
 * `reps` may be fractional (the RPE chart uses "5 reps with 1.5 in the tank" = 6.5), but must be
 * between 1 and 30. Shared by every function below and by the RPE chart, so the formula exists
 * once.
 */
export function epleyMultiplier(reps: number): number {
  assertFinite(reps, 'reps');
  if (reps < 1 || reps > MAX_EPLEY_REPS) {
    throw new RangeError(`reps must be between 1 and ${MAX_EPLEY_REPS}, got ${reps}`);
  }
  return reps === 1 ? 1 : 1 + reps / 30;
}

/**
 * The estimated 1RM for a set. Inputs: weight lifted (kg, above 0) and whole reps (1–30).
 * Output: the estimate in kg, unrounded. Examples: 100 kg × 5 → 116.67; 100 kg × 1 → 100.
 * Callers that show it to a lifter pass the result through `displayWeight` for their unit.
 */
export function epleyE1rm(weightKg: number, reps: number): number {
  assertPositive(weightKg, 'weightKg');
  assertWholeInRange(reps, 1, MAX_EPLEY_REPS, 'reps');
  return weightKg * epleyMultiplier(reps);
}

/**
 * Epley run backwards: given a 1RM, the heaviest weight a lifter should manage for `reps` reps.
 * Example: 1RM 116.67 kg, 5 reps → 100 kg. Inputs: 1RM in kg (above 0), whole reps (1–30).
 */
export function weightForReps(oneRmKg: number, reps: number): number {
  assertPositive(oneRmKg, 'oneRmKg');
  assertWholeInRange(reps, 1, MAX_EPLEY_REPS, 'reps');
  return oneRmKg / epleyMultiplier(reps);
}
