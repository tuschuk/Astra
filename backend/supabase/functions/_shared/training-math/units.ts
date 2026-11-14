/**
 * Weight units: converting between kilograms and pounds, and rounding numbers for people to read.
 *
 * Why this exists: Astra stores every weight in kilograms (the `sets.weight_kg` column). A
 * lifter's kg/lb choice (`user_settings.unit`) only changes what they *see*. Keeping conversion
 * in one place means a weight never drifts when someone flips units back and forth.
 *
 * The one rule: rounded numbers are for screens only. Nothing here hands back a rounded value
 * meant to be saved — `lbToKg` (used when someone types a weight in pounds) is exact.
 */
import { assertFinite, assertPositive } from './validate.ts';

/** A display unit, matching the values allowed in `user_settings.unit`. */
export type WeightUnit = 'kg' | 'lb';

/** Kilograms in one pound — exact, by the international definition of the pound (1959). */
export const KG_PER_LB = 0.45359237;

/**
 * Kilograms → pounds, exact (no rounding).
 * Input: a weight in kg. Output: the same weight in lb. Feeds math, not screens.
 */
export function kgToLb(kg: number): number {
  assertFinite(kg, 'kg');
  return kg / KG_PER_LB;
}

/**
 * Pounds → kilograms, exact (no rounding).
 * This is the one storage-direction conversion: when a lifter types 225 in lb, the app saves
 * `lbToKg(225)` unrounded, so switching units later never changes what is stored.
 */
export function lbToKg(lb: number): number {
  assertFinite(lb, 'lb');
  return lb * KG_PER_LB;
}

/**
 * A stored kg weight → the number to show the lifter, in their unit, rounded to one decimal.
 * Example: displayWeight(100, 'lb') → 220.5. Display only — never write the result back.
 */
export function displayWeight(kg: number, unit: WeightUnit): number {
  assertFinite(kg, 'kg');
  const value = unit === 'lb' ? kgToLb(kg) : kg;
  return Math.round(value * 10) / 10;
}

/**
 * Snap a number to the nearest multiple of a step, e.g. a calculator suggestion of 101.3 kg to
 * the nearest 2.5 kg → 102.5. Calculators use this so they suggest a weight you can actually
 * load. Inputs: the value and a step greater than zero (both in the same unit).
 */
export function roundToIncrement(value: number, increment: number): number {
  assertFinite(value, 'value');
  assertPositive(increment, 'increment');
  // toFixed(9) strips float noise like 0.1 * 3 = 0.30000000000000004.
  return Number((Math.round(value / increment) * increment).toFixed(9));
}
