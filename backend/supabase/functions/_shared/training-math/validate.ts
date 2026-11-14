/**
 * Input checks shared by every calculator in this module.
 *
 * Why this exists: the calculators only make sense for sensible input (reps 1–30, a weight above
 * zero…). When a caller passes something else, the math throws a `RangeError` naming the bad
 * input instead of quietly returning a wrong-but-plausible weight. Screens validate their own
 * fields first; these checks are the safety net behind them.
 */

/** Throws unless `value` is a real, finite number (not NaN or Infinity). */
export function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
}

/** Throws unless `value` is a finite number greater than zero — e.g. a weight or a 1RM. */
export function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than 0, got ${value}`);
}

/** Throws unless `value` is a whole number from `min` to `max` inclusive — e.g. a rep count. */
export function assertWholeInRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number from ${min} to ${max}, got ${value}`);
  }
}
