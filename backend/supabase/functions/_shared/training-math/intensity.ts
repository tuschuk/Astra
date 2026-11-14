/**
 * The intensity calculator: "what is 80% of my 1RM?"
 *
 * Why this exists: programs prescribe work as a percentage of a lifter's one-rep max. This turns
 * that percentage into a weight. Weights are kilograms; the answer is unrounded — the calculator
 * screen snaps it to a loadable step with `roundToIncrement`.
 */
import { assertFinite, assertPositive } from './validate.ts';

/** Highest percentage accepted. Above 100% is legitimate (overloads, band-assisted work). */
export const MAX_PERCENT = 150;

/**
 * Working weight for a percentage of a 1RM. Inputs: 1RM in kg (above 0) and a percentage above
 * 0 and up to 150. Output: kg. Example: 1RM 200 kg at 80 → 160 kg.
 * Out-of-range input throws rather than guessing — a silently clamped number would look right.
 */
export function workingWeightFromPercent(oneRmKg: number, percent: number): number {
  assertPositive(oneRmKg, 'oneRmKg');
  assertFinite(percent, 'percent');
  if (percent <= 0 || percent > MAX_PERCENT) {
    throw new RangeError(`percent must be above 0 and at most ${MAX_PERCENT}, got ${percent}`);
  }
  return (oneRmKg * percent) / 100;
}
