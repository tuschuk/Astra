/**
 * Turning workout data into the short text the logger screens show, and turning what the
 * lifter typed back into numbers.
 *
 * Why this exists: the Workout tab, the logger and the saved-workout screen all print sets
 * ("8 × 185 lb"), dates and durations the same way, and all read the reps / weight boxes the
 * same way. Keeping that here means one spelling everywhere and plain functions that are easy
 * to test. No weight math lives here: converting kg to the lifter's unit is `displayWeight`
 * from `@training-math`; this file only decides how the resulting number is written.
 */
import { displayWeight, type WeightUnit } from '@training-math';

import type { SetRow } from '@/db/dao';

/** The two parts of a set that make up its load: how many reps at what weight. */
type RepsAndWeight = Pick<SetRow, 'reps' | 'weight_kg'>;

/** The parts of a set the logger prints for one set: its load, plus warm-up flag and RPE (B10). */
type PrintableSet = Pick<SetRow, 'reps' | 'weight_kg' | 'rpe' | 'is_warmup'>;

/** The parts of a past set the "last time" line reads: its load and whether it was a warm-up. */
type LastTimeSet = Pick<SetRow, 'reps' | 'weight_kg' | 'is_warmup'>;

/**
 * A stored kg weight as the lifter reads it, e.g. `formatWeight(83.91, 'lb')` → "185 lb".
 * Uses the shared display rounding (one decimal), so the number never disagrees with any
 * other screen.
 */
export function formatWeight(weightKg: number, unit: WeightUnit): string {
  return `${displayWeight(weightKg, unit)} ${unit}`;
}

/** A set's load alone: "8 × 185 lb", "8 reps", "185 lb" or "—". */
function formatLoad(set: RepsAndWeight, unit: WeightUnit): string {
  if (set.reps != null && set.weight_kg != null) return `${set.reps} × ${formatWeight(set.weight_kg, unit)}`;
  if (set.reps != null) return set.reps === 1 ? '1 rep' : `${set.reps} reps`;
  if (set.weight_kg != null) return formatWeight(set.weight_kg, unit);
  return '—';
}

/**
 * One set as a short line: "8 × 185 lb", or "8 reps" with no weight (a bodyweight pull-up),
 * "185 lb" with no reps, and "—" if neither was entered. A warm-up set starts with "W · "
 * ("W · 8 × 135 lb") and a set with an RPE ends with it ("8 × 185 lb @ RPE 8.5"). Every screen
 * that lists sets — the logger, the saved workout — prints them through this one function.
 */
export function formatSet(set: PrintableSet, unit: WeightUnit): string {
  const warmup = set.is_warmup ? 'W · ' : '';
  const rpe = set.rpe != null ? ` @ RPE ${set.rpe}` : '';
  return `${warmup}${formatLoad(set, unit)}${rpe}`;
}

/**
 * The "last time" summary of a previous session's sets (LOG-5), with runs of identical sets
 * grouped so it stays one line: three sets of 8 at 185 lb then one of 6 →
 * "3 × 8 @ 185 lb, 6 @ 185 lb". Warm-up sets are left out — the line answers "what did I
 * work at last time?", and warm-ups aren't work (LOG-14). Returns "" when no work sets remain.
 */
export function formatLastTime(sets: readonly LastTimeSet[], unit: WeightUnit): string {
  const groups: { set: RepsAndWeight; count: number }[] = [];
  for (const set of sets) {
    if (set.is_warmup) continue;
    const last = groups[groups.length - 1];
    if (last && last.set.reps === set.reps && last.set.weight_kg === set.weight_kg) last.count += 1;
    else groups.push({ set, count: 1 });
  }
  return groups
    .map(({ set, count }) => {
      const reps = set.reps == null ? null : count > 1 ? `${count} × ${set.reps}` : `${set.reps}`;
      const weight = set.weight_kg == null ? null : formatWeight(set.weight_kg, unit);
      if (reps && weight) return `${reps} @ ${weight}`;
      if (reps) return `${reps} reps`;
      if (weight) return count > 1 ? `${count} × ${weight}` : weight;
      return count > 1 ? `${count} × —` : '—';
    })
    .join(', ');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The name a workout goes by until titles exist (B12): its start date in the phone's own time
 * zone, e.g. "Sat, Nov 14, 2026". Written by hand rather than with the device's locale tools so
 * every phone (and every test machine) prints it the same way.
 */
export function workoutDateLabel(startedAt: string): string {
  const d = new Date(startedAt);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * How long a finished workout took, rounded to the minute: "45 min", "1 h 5 min", "2 h".
 * Returns "" when the workout has no end yet.
 */
export function workoutDurationLabel(startedAt: string, endedAt: string | null): string {
  if (endedAt == null) return '';
  const minutes = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "1 exercise" / "3 exercises", "1 set" / "12 sets" — the counts under a past workout. */
export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** How many sets were logged across a workout's exercises. */
export function totalSets(entries: readonly { sets: readonly unknown[] }[]): number {
  return entries.reduce((total, entry) => total + entry.sets.length, 0);
}

/**
 * The one-line summary under a finished workout's name, as the history list and the saved
 * workout both show it: "58 min · 3 exercises · 12 sets" (the duration is left out if unknown).
 */
export function workoutDetailsLabel(
  workout: { started_at: string; ended_at: string | null },
  exerciseCount: number,
  setCount: number,
): string {
  return [
    workoutDurationLabel(workout.started_at, workout.ended_at),
    countLabel(exerciseCount, 'exercise'),
    countLabel(setCount, 'set'),
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/**
 * What came out of reading one number box: `value` is null when the box was left empty;
 * `ok: false` means the text isn't a plain non-negative number ("abc", "-5", "1e3").
 */
export type ParsedNumber = { ok: true; value: number | null } | { ok: false };

/**
 * Reads what the lifter typed into the reps or weight box. Accepts "185", "102.5", ".5" and
 * comma decimals ("102,5", common on European keyboards). Range rules (whole reps, weight
 * below 10 000 kg) are not checked here — the active-workout store checks them against the
 * server's rules when the set is saved.
 */
export function parseNumberInput(text: string): ParsedNumber {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return { ok: true, value: null };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return { ok: false };
  return { ok: true, value: Number(normalized) };
}

/**
 * Turns a refused set into a sentence for the lifter. The store throws a `RangeError` naming
 * the field the server would refuse (see `assertValidSetFields` in `@training-math`); anything
 * else is an unexpected failure.
 */
export function setErrorMessage(error: unknown): string {
  if (error instanceof RangeError) {
    if (error.message.startsWith('reps')) return 'Reps must be a whole number.';
    if (error.message.startsWith('weight')) return 'That weight is too big to save.';
    if (error.message.startsWith('rpe')) return 'RPE goes from 1 to 10.';
    return 'That set has a value Astra can’t save.';
  }
  return 'That set couldn’t be saved. Try again.';
}
