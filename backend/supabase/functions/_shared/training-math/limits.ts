/**
 * The server's limits on a logged set, checked before the set is saved on the phone.
 *
 * Why this exists: the phone saves sets offline and uploads them later. The server refuses any
 * set that breaks one of its rules (a negative rep count, an RPE of 11, a weight too big for its
 * column) — and a refused set sits at the front of the upload queue forever, blocking every
 * workout behind it. So the phone checks the same rules the moment a set is typed, and a value
 * the server would refuse never gets saved at all.
 *
 * These rules must match the server EXACTLY. Stricter would refuse sets the server accepts;
 * looser would let a poisoned set through. They are copied by hand from the `sets` table in
 * `backend/supabase/migrations/20261114100100_training.sql` — nothing runs both the SQL and this
 * file, so whoever changes a CHECK or column type there must change it here too:
 *
 *   position          smallint not null check (position >= 0)      → whole, 0 … 32767
 *   reps              integer   check (reps >= 0)                  → whole, 0 … 2147483647
 *   weight_kg         numeric(6, 2) check (weight_kg >= 0)         → 0 ≤ w < 10000, 2 decimals
 *   rpe               numeric(3, 1) check (rpe between 1 and 10)   → 1 … 10, 1 decimal
 *   drop_set_position smallint  check (drop_set_position >= 1)     → whole, 1 … 32767
 *   duration_seconds  integer   check (duration_seconds >= 0)      → whole, 0 … 2147483647
 *   score             text      check (char_length(score) <= 100)  → at most 100 characters
 *                     (added by 20261115024010_sets_score.sql)
 *
 * And one rule from the `workout_exercises` table in the same training migration:
 *
 *   superset_group    smallint  (no CHECK)                         → whole, 1 … 32767
 *
 * The upper bounds come from the column types (a value bigger than the column holds is refused
 * just like a broken CHECK). Weight and RPE are checked after rounding to their column's
 * decimals — see `roundWeightKgForStorage` / `roundRpeForStorage`.
 */
import { roundToIncrement } from './units.ts';
import { assertFinite, assertWholeInRange } from './validate.ts';

/** Largest value a Postgres `smallint` column holds. */
export const MAX_SMALLINT = 32767;
/** Largest value a Postgres `integer` column holds. */
export const MAX_INTEGER = 2147483647;
/** `weight_kg` is numeric(6, 2): at most four digits before the decimal point. */
export const MAX_WEIGHT_KG_EXCLUSIVE = 10000;
/** Lowest RPE the server accepts on a set (CHECK `rpe between 1 and 10`). */
export const MIN_SET_RPE = 1;
/** Highest RPE the server accepts on a set (same CHECK). */
export const MAX_SET_RPE = 10;
/** Longest WOD score text the server accepts (CHECK `char_length(score) <= 100`). */
export const MAX_SET_SCORE_LENGTH = 100;

/**
 * Rounds a kg weight to the 2 decimals its server column keeps (numeric(6, 2)).
 * Why: the server rounds whatever it is sent; rounding on the phone first means the phone and
 * the server hold the identical number, so downloading the workout back changes nothing.
 * Example: 225 lb → lbToKg = 102.05828… kg → 102.06 kg stored (shows as 225.0 lb again).
 */
export function roundWeightKgForStorage(kg: number): number {
  return roundToIncrement(kg, 0.01);
}

/** Rounds an RPE to the 1 decimal its server column keeps (numeric(3, 1)); same reason as weight. */
export function roundRpeForStorage(rpe: number): number {
  return roundToIncrement(rpe, 0.1);
}

/**
 * One set's values as they will be stored. `null`/missing optional fields are always allowed
 * (the server columns are nullable); only present values are checked.
 */
export interface SetFieldsToCheck {
  position: number;
  reps?: number | null;
  /** Already rounded with `roundWeightKgForStorage`. */
  weightKg?: number | null;
  /** Already rounded with `roundRpeForStorage`. */
  rpe?: number | null;
  dropSetPosition?: number | null;
  durationSeconds?: number | null;
  /** Free-text WOD score ("7 rounds + 12 reps"), already trimmed. */
  score?: string | null;
}

/**
 * Throws a `RangeError` naming the first value the server would refuse; returns quietly if the
 * whole set is acceptable. Call it before every save of a set (see the file comment).
 */
export function assertValidSetFields(fields: SetFieldsToCheck): void {
  assertWholeInRange(fields.position, 0, MAX_SMALLINT, 'position');
  if (fields.reps != null) assertWholeInRange(fields.reps, 0, MAX_INTEGER, 'reps');
  if (fields.weightKg != null) {
    assertFinite(fields.weightKg, 'weightKg');
    if (fields.weightKg < 0 || fields.weightKg >= MAX_WEIGHT_KG_EXCLUSIVE) {
      throw new RangeError(
        `weightKg must be at least 0 and below ${MAX_WEIGHT_KG_EXCLUSIVE}, got ${fields.weightKg}`,
      );
    }
  }
  if (fields.rpe != null) {
    assertFinite(fields.rpe, 'rpe');
    if (fields.rpe < MIN_SET_RPE || fields.rpe > MAX_SET_RPE) {
      throw new RangeError(`rpe must be from ${MIN_SET_RPE} to ${MAX_SET_RPE}, got ${fields.rpe}`);
    }
  }
  if (fields.dropSetPosition != null) {
    assertWholeInRange(fields.dropSetPosition, 1, MAX_SMALLINT, 'dropSetPosition');
  }
  if (fields.durationSeconds != null) {
    assertWholeInRange(fields.durationSeconds, 0, MAX_INTEGER, 'durationSeconds');
  }
  if (fields.score != null && scoreLength(fields.score) > MAX_SET_SCORE_LENGTH) {
    throw new RangeError(
      `score must be at most ${MAX_SET_SCORE_LENGTH} characters, got ${scoreLength(fields.score)}`,
    );
  }
}

/**
 * How Postgres's `char_length` counts a text: one per character (code point), so an emoji
 * counts once — whereas JavaScript's `.length` counts it twice. Counting the server's way keeps
 * a 100-character score with an emoji in it from being refused here but accepted there.
 */
function scoreLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Throws a `RangeError` if `group` can't be stored as a superset number — the label that ties
 * exercises done back-to-back together (`workout_exercises.superset_group`). The server column
 * is a smallint with no other rule; groups start at 1 so "no superset" stays plainly `null`.
 * Call it before saving a superset number.
 */
export function assertValidSupersetGroup(group: number): void {
  assertWholeInRange(group, 1, MAX_SMALLINT, 'supersetGroup');
}
