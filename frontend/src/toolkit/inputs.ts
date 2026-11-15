/**
 * Reading what the lifter typed into a Tool Kit calculator, and the loadable step its answers
 * snap to.
 *
 * Why this exists: all four calculators take typed numbers, and each one has to tell three
 * cases apart — nothing typed yet (show no answer, no complaint), something that isn't a usable
 * number (say why, inline), and a good value. Doing that here, once, keeps every calculator's
 * error wording the same and keeps the screens free of parsing rules. It also means the training
 * math (`@training-math`) only ever sees numbers inside its own allowed range — its RangeError
 * stays a safety net, never something the lifter sees.
 *
 * No training math lives here: weights are converted to kg with the module's `lbToKg`, and the
 * snapping uses the module's `kgToLb` / `roundToIncrement`.
 */
import { kgToLb, lbToKg, MAX_PERCENT, roundToIncrement, type WeightUnit } from '@training-math';

import { parseNumberInput } from '@/workout/format';

/** What a typed box holds: nothing yet, something unusable (with why), or a usable number. */
export type FieldReading =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; value: number };

/** Heaviest weight the weight calculators accept, in the lifter's unit — far past any lift. */
export const MAX_CALCULATOR_WEIGHT = 10000;

/**
 * The step a working weight is rounded to so it can be loaded on a bar: 2.5 kg or 5 lb (the
 * smallest jump a pair of the usual smallest plates makes — what published programs round to).
 */
export const LOADABLE_STEP: Record<WeightUnit, number> = { kg: 2.5, lb: 5 };

/**
 * Reads a number box that must be above 0 and at most `max`. `what` names the value in the
 * message ("a weight", "a percentage"). Decimal commas are fine ("102,5").
 */
export function readPositiveNumber(text: string, max: number, what: string): FieldReading {
  const parsed = parseNumberInput(text);
  if (!parsed.ok) return { kind: 'invalid', message: `Enter ${what} as a number.` };
  if (parsed.value === null) return { kind: 'empty' };
  if (parsed.value <= 0 || parsed.value > max || !Number.isFinite(parsed.value)) {
    return { kind: 'invalid', message: `Enter ${what} above 0 and up to ${max}.` };
  }
  return { kind: 'ok', value: parsed.value };
}

/**
 * Reads a number box where 0 is allowed, up to `max` — the plate loader's bar box (0 = plates
 * loaded on a pin, a landmine, a bare sleeve). `what` names the value in the message.
 */
export function readZeroOrMore(text: string, max: number, what: string): FieldReading {
  const parsed = parseNumberInput(text);
  if (!parsed.ok) return { kind: 'invalid', message: `Enter ${what} as a number.` };
  if (parsed.value === null) return { kind: 'empty' };
  if (parsed.value > max) return { kind: 'invalid', message: `Enter ${what} up to ${max}.` };
  return { kind: 'ok', value: parsed.value };
}

/**
 * Reads a weight typed in the lifter's unit and hands it back in **kg**, the unit the training
 * math works in. Example: "225" in lb → about 102.06 (kg), unrounded.
 */
export function readWeightKg(text: string, unit: WeightUnit): FieldReading {
  const reading = readPositiveNumber(text, MAX_CALCULATOR_WEIGHT, 'a weight');
  if (reading.kind !== 'ok') return reading;
  return { kind: 'ok', value: unit === 'lb' ? lbToKg(reading.value) : reading.value };
}

/** Reads a whole-number box (a rep count) that must be from `min` to `max`. */
export function readWholeNumber(text: string, min: number, max: number, what: string): FieldReading {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid', message: `Enter ${what} as a whole number.` };
  const value = Number(trimmed);
  if (value < min || value > max) return { kind: 'invalid', message: `Enter ${what} from ${min} to ${max}.` };
  return { kind: 'ok', value };
}

/**
 * Reads a percentage of a 1RM: above 0 and up to the module's own ceiling (`MAX_PERCENT`, 150 —
 * past 100 is real: overloads and supported holds), decimals allowed.
 */
export function readPercent(text: string): FieldReading {
  return readPositiveNumber(text, MAX_PERCENT, 'a percentage');
}

/**
 * The nearest weight a lifter can actually load, in their unit: a kg answer converted to the
 * display unit and snapped to `LOADABLE_STEP`. Example: 121.6 kg → 122.5 (kg) or 270 (lb).
 */
export function loadableWeight(weightKg: number, unit: WeightUnit): number {
  const inUnit = unit === 'lb' ? kgToLb(weightKg) : weightKg;
  return roundToIncrement(inUnit, LOADABLE_STEP[unit]);
}
