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
import { displayWeight, MAX_SET_SCORE_LENGTH, type WeightUnit } from '@training-math';

import type { PersonalRecordRow, SetRow, WorkoutExerciseRow } from '@/db/dao';

/** The two parts of a set that make up its load: how many reps at what weight. */
type RepsAndWeight = Pick<SetRow, 'reps' | 'weight_kg'>;

/**
 * The parts of a set the logger prints for one set: its load, warm-up flag and RPE (B10), and
 * its time and score for timed / WOD-style work (B11).
 */
type PrintableSet = Pick<SetRow, 'reps' | 'weight_kg' | 'rpe' | 'is_warmup' | 'duration_seconds' | 'score'>;

/** The parts of a past set the "last time" line reads: its load, its time, and whether it was a warm-up. */
type LastTimeSet = Pick<SetRow, 'reps' | 'weight_kg' | 'is_warmup' | 'duration_seconds'>;

/**
 * A stored kg weight as the lifter reads it, e.g. `formatWeight(83.91, 'lb')` → "185 lb".
 * Uses the shared display rounding (one decimal), so the number never disagrees with any
 * other screen.
 */
export function formatWeight(weightKg: number, unit: WeightUnit): string {
  return `${displayWeight(weightKg, unit)} ${unit}`;
}

/** A set's load alone: "8 × 185 lb", "8 reps", "185 lb", or null when neither was entered. */
function formatLoad(set: RepsAndWeight, unit: WeightUnit): string | null {
  if (set.reps != null && set.weight_kg != null) return `${set.reps} × ${formatWeight(set.weight_kg, unit)}`;
  if (set.reps != null) return set.reps === 1 ? '1 rep' : `${set.reps} reps`;
  if (set.weight_kg != null) return formatWeight(set.weight_kg, unit);
  return null;
}

/**
 * A number of seconds as a clock reading: 45 → "0:45", 272 → "4:32", 3750 → "1:02:30".
 * Used for timed work (a plank, a WOD done for time).
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * One set as a short line. Its parts, in order:
 *   - "W · " first for a warm-up ("W · 8 × 135 lb");
 *   - the load: "8 × 185 lb", "8 reps" (a bodyweight pull-up) or "185 lb";
 *   - the time, for timed work: joined to the load with " · " ("100 reps · 7:32",
 *     "45 lb · 1:00" for a weighted plank) or alone ("4:32");
 *   - the RPE: " @ RPE 8.5";
 *   - the score of a scored WOD: after " · " ("20:00 · 7 rounds + 12 reps"), or alone when it
 *     is all the set says ("7 rounds + 12 reps").
 * "—" when nothing at all was entered. Every screen that lists sets — the logger, the saved
 * workout, and the feed when it arrives — prints them through this one function.
 */
export function formatSet(set: PrintableSet, unit: WeightUnit): string {
  const warmup = set.is_warmup ? 'W · ' : '';
  const rpe = set.rpe != null ? ` @ RPE ${set.rpe}` : '';
  const parts = [formatLoad(set, unit), set.duration_seconds != null ? formatDuration(set.duration_seconds) : null];
  const core = parts.filter((part): part is string => part != null).join(' · ');
  if (core === '' && set.score != null) return `${warmup}${set.score}${rpe}`;
  const score = set.score != null ? ` · ${set.score}` : '';
  return `${warmup}${core === '' ? '—' : core}${rpe}${score}`;
}

/**
 * A whole drop set as one line (LOG-12): each segment's load in order, joined by arrows —
 * "8 × 225 lb → 8 × 185 lb → 10 × 155 lb". The warm-up mark comes from the top set only
 * (it applies to the whole chain); each segment keeps its own RPE. A "drop set" of one segment
 * prints as an ordinary set.
 */
export function formatDropSet(segments: readonly PrintableSet[], unit: WeightUnit): string {
  return segments.map((segment, i) => formatSet(i === 0 ? segment : { ...segment, is_warmup: false }, unit)).join(' → ');
}

/**
 * Groups an exercise's sets (in logged order) into the sets the lifter thinks in: an ordinary
 * set is a group of one; a drop set is its top set followed by its drops (LOG-12).
 *
 * The rule: a set joins the group before it when it carries a drop number bigger than the
 * previous set's (the top set counts as 0). So 8 × 225, then drops 1 and 2, form one group.
 * Anything that breaks the climb starts a new group, which keeps odd data from being merged
 * wrongly: a set copied by Repeat after a drop (same drop number again) shows as its own set,
 * and a removed middle drop (1, 3) leaves the rest of the chain together.
 */
export function groupDropSets<T extends Pick<SetRow, 'drop_set_position'>>(sets: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const set of sets) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    const continues =
      previous != null && set.drop_set_position != null && set.drop_set_position > (previous.drop_set_position ?? 0);
    if (continues) current.push(set);
    else groups.push([set]);
  }
  return groups;
}

/**
 * Splits a workout's exercises (in order) into the units they are shown as (LOG-11): exercises
 * next to each other with the same superset number form one superset; every other exercise is
 * a unit of its own. Only neighbours merge — an exercise moved away from its superset simply
 * shows on its own until it is linked again. `superset` is false for a lone exercise.
 */
export function supersetRuns<T extends Pick<WorkoutExerciseRow, 'superset_group'>>(
  entries: readonly T[],
): { superset: boolean; entries: T[] }[] {
  const runs: T[][] = [];
  for (const entry of entries) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    if (previous != null && entry.superset_group != null && entry.superset_group === previous.superset_group) {
      current.push(entry);
    } else {
      runs.push([entry]);
    }
  }
  return runs.map((run) => ({ superset: run.length > 1, entries: run }));
}

/**
 * Where each exercise sits in the supersets on screen, one item per exercise in order:
 * `linkedToPrevious` when it is supersetted with the exercise just above it (its card's link
 * toggle is on), `inSuperset` when it is part of any superset (its card shows the badge).
 */
export function supersetPlacement(
  entries: readonly Pick<WorkoutExerciseRow, 'superset_group'>[],
): { linkedToPrevious: boolean; inSuperset: boolean }[] {
  return supersetRuns(entries).flatMap(({ superset, entries: run }) =>
    run.map((_, i) => ({ linkedToPrevious: superset && i > 0, inSuperset: superset })),
  );
}

/**
 * The "last time" summary of a previous session's sets (LOG-5), with runs of identical sets
 * grouped so it stays one line: three sets of 8 at 185 lb then one of 6 →
 * "3 × 8 @ 185 lb, 6 @ 185 lb". Timed sets show their time ("3 × 1:00" for three one-minute
 * planks). Warm-up sets are left out — the line answers "what did I work at last time?", and
 * warm-ups aren't work (LOG-14). Each drop of a drop set counts as its own set here, and
 * scores are left out, to keep it one short line. Returns "" when no work sets remain.
 */
export function formatLastTime(sets: readonly LastTimeSet[], unit: WeightUnit): string {
  const groups: { set: LastTimeSet; count: number }[] = [];
  for (const set of sets) {
    if (set.is_warmup) continue;
    const last = groups[groups.length - 1];
    if (
      last &&
      last.set.reps === set.reps &&
      last.set.weight_kg === set.weight_kg &&
      last.set.duration_seconds === set.duration_seconds
    ) {
      last.count += 1;
    } else {
      groups.push({ set, count: 1 });
    }
  }
  return groups
    .map(({ set, count }) => {
      const times = (text: string) => (count > 1 ? `${count} × ${text}` : text);
      const reps = set.reps == null ? null : count > 1 ? `${count} × ${set.reps}` : `${set.reps}`;
      const weight = set.weight_kg == null ? null : formatWeight(set.weight_kg, unit);
      const time = set.duration_seconds == null ? null : formatDuration(set.duration_seconds);
      let load: string | null = null;
      if (reps && weight) load = `${reps} @ ${weight}`;
      else if (reps) load = `${reps} reps`;
      else if (weight) load = times(weight);
      if (load && time) return `${load} · ${time}`;
      if (load) return load;
      return times(time ?? '—');
    })
    .join(', ');
}

/** The parts of a stored personal record the PR text reads. */
type PrintableRecord = Pick<PersonalRecordRow, 'kind' | 'reps' | 'value_kg'>;

/**
 * The short name of a record book (LOG-4): "1RM" for the heaviest single, "e1RM" for the best
 * estimated one-rep max, "5RM" for the heaviest weight for exactly 5 reps.
 */
export function prBookLabel(record: Pick<PersonalRecordRow, 'kind' | 'reps'>): string {
  if (record.kind === 'true1rm') return '1RM';
  if (record.kind === 'e1rm') return 'e1RM';
  return `${record.reps ?? '?'}RM`;
}

/**
 * A lifter's current records for one exercise as one line, in the order given (see
 * `currentPrs`): "1RM 225 lb · e1RM 243.1 lb · 5RM 205 lb". The e1RM is an estimate (Epley) —
 * the "e" says so. Returns "" when there are no records.
 */
export function formatPrLine(records: readonly PrintableRecord[], unit: WeightUnit): string {
  return records.map((r) => `${prBookLabel(r)} ${formatWeight(r.value_kg, unit)}`).join(' · ');
}

/**
 * The badge on a set that holds records: "PR · 5RM", or "PR · 1RM · e1RM" when one set holds
 * several books. Returns "" when the set holds none.
 */
export function formatPrBadge(records: readonly Pick<PersonalRecordRow, 'kind' | 'reps'>[]): string {
  if (records.length === 0) return '';
  return ['PR', ...records.map(prBookLabel)].join(' · ');
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
 * Reads what the lifter typed into the Time box, in seconds: a bare number is seconds ("90" →
 * 90), "m:ss" is minutes and seconds ("4:32" → 272), "h:mm:ss" adds hours ("1:02:30" → 3750).
 * After the first part, each part is exactly two digits below 60, so "4:5" or "1:75" is
 * refused rather than guessed at. Commas are refused too: "4,32" might mean 4.32 seconds, and
 * must not quietly turn into 4 minutes 32. An empty box is `value: null` (no time).
 */
export function parseDurationInput(text: string): ParsedNumber {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (!/^\d+(:\d{2}){0,2}$/.test(trimmed)) return { ok: false };
  const parts = trimmed.split(':').map(Number);
  if (parts.slice(1).some((part) => part >= 60)) return { ok: false };
  return { ok: true, value: parts.reduce((total, part) => total * 60 + part, 0) };
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
    if (error.message.startsWith('durationSeconds')) return 'That time is too long to save.';
    if (error.message.startsWith('score')) return `Keep the score to ${MAX_SET_SCORE_LENGTH} characters.`;
    return 'That set has a value Astra can’t save.';
  }
  return 'That set couldn’t be saved. Try again.';
}

/**
 * Turns a refused title or note save into a sentence for the lifter (LOG-3). The store throws a
 * `RangeError` when the text is longer than the server accepts (the inputs' own length limits
 * make that rare); anything else is an unexpected failure.
 */
export function textErrorMessage(error: unknown): string {
  if (error instanceof RangeError) return 'That’s too long to save — shorten it a little.';
  return 'That couldn’t be saved. Try again.';
}
