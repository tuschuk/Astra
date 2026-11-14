/**
 * The RPE calculator: "I want 5 reps at RPE 8 — what weight?"
 *
 * RPE (rate of perceived exertion) scores how hard a set felt on a 10-point scale; RPE 8 means
 * "I had about 2 more reps in me". So 5 reps at RPE 8 is roughly the weight you could do for
 * 7 reps all-out. Astra's chart is built from that idea plus the Epley formula (e1rm.ts),
 * rather than copied from a published table, so a set done at the suggested weight gives back
 * exactly the e1RM it came from. Published RPE charts are themselves estimates and land within
 * a couple of percent of these numbers in the supported range.
 */
import { epleyMultiplier } from './e1rm.ts';
import { workingWeightFromPercent } from './intensity.ts';
import { assertFinite, assertWholeInRange } from './validate.ts';

/** Rep range the RPE chart covers. Past 12 reps, RPE ratings get unreliable. */
export const MIN_RPE_REPS = 1;
export const MAX_RPE_REPS = 12;
/** RPE range the chart covers, in half steps. Below 6 the estimate is noise. */
export const MIN_RPE = 6;
export const MAX_RPE = 10;

/**
 * What percentage of a 1RM a set of `reps` at `rpe` should be.
 * Inputs: whole reps 1–12; RPE 6–10 in steps of 0.5. Output: a percentage, e.g. 5 @ RPE 8 → 81.08.
 * How: reps left in the tank = 10 − RPE; treat the set as (reps + reps left) all-out reps; Epley
 * says what fraction of a 1RM that is. 1 rep @ RPE 10 is exactly 100%.
 */
export function percentOfOneRm(reps: number, rpe: number): number {
  assertWholeInRange(reps, MIN_RPE_REPS, MAX_RPE_REPS, 'reps');
  assertFinite(rpe, 'rpe');
  if (rpe < MIN_RPE || rpe > MAX_RPE || !Number.isInteger(rpe * 2)) {
    throw new RangeError(`rpe must be ${MIN_RPE}–${MAX_RPE} in steps of 0.5, got ${rpe}`);
  }
  const repsInReserve = MAX_RPE - rpe;
  return 100 / epleyMultiplier(reps + repsInReserve);
}

/**
 * Working weight for a target reps/RPE pair, given the lifter's 1RM in kg.
 * Example: 1RM 150 kg, 5 reps @ RPE 8 → 121.6 kg (unrounded; snap with `roundToIncrement`).
 */
export function workingWeightFromRpe(oneRmKg: number, reps: number, rpe: number): number {
  return workingWeightFromPercent(oneRmKg, percentOfOneRm(reps, rpe));
}
