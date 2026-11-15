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
 *   notes             text      check (char_length(notes) <= 500)  → at most 500 characters
 *                     (added by 20261115031049_sets_notes.sql)
 *
 * And rules from the `workout_exercises` and `workouts` tables in the same training migration:
 *
 *   workout_exercises.superset_group smallint (no CHECK)                → whole, 1 … 32767
 *   workout_exercises.notes text check (char_length(notes) <= 1000)     → at most 1000 characters
 *   workouts.title          text check (char_length(title) <= 100)      → at most 100 characters
 *   workouts.notes          text check (char_length(notes) <= 2000)     → at most 2000 characters
 *
 * And the `exercises` table (B31, a lifter's own custom exercises):
 *
 *   exercises.name text not null check (char_length(name) between 1 and 80) → 1 … 80 characters
 *
 * And the four program tables (B34, `20261115193156_programs.sql`):
 *
 *   programs.name                text not null check (char_length between 1 and 100) → 1 … 100 characters
 *   program_workouts.name        text check (char_length(name) <= 100)               → at most 100, or none
 *   program_weeks / program_workouts / program_exercises.position
 *                                smallint not null check (position >= 0)             → whole, 0 … 32767
 *   program_exercises.target_sets      smallint not null check (>= 1)                → whole, 1 … 32767
 *   program_exercises.target_reps      integer check (>= 0)                          → whole, 0 … 2147483647
 *   program_exercises.target_weight_kg numeric(6, 2) check (>= 0)                    → 0 ≤ w < 10000
 *   program_exercises.target_rpe       numeric(3, 1) check (between 1 and 10)        → 1 … 10
 *
 * And the `teams` table (B36, `20261115212541_teams.sql`):
 *
 *   teams.name text not null check (char_length(name) between 1 and 80)    → 1 … 80 characters
 *
 * And the `team_posts` table (B37, `20261115222643_team_coaching.sql`):
 *
 *   team_posts.body text check (char_length(body) between 1 and 2000)     → 1 … 2000 characters
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
/** Longest note on one set (CHECK `char_length(notes) <= 500`, …_sets_notes.sql). */
export const MAX_SET_NOTES_LENGTH = 500;
/** Longest note on one exercise of a workout (`workout_exercises.notes`, CHECK ≤ 1000). */
export const MAX_ENTRY_NOTES_LENGTH = 1000;
/** Longest workout title (`workouts.title`, CHECK ≤ 100). */
export const MAX_WORKOUT_TITLE_LENGTH = 100;
/** Longest note on a whole workout (`workouts.notes`, CHECK ≤ 2000). */
export const MAX_WORKOUT_NOTES_LENGTH = 2000;

/** Longest name of an exercise (`exercises.name`, CHECK between 1 and 80). */
export const MAX_EXERCISE_NAME_LENGTH = 80;

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
  /** The lifter's remark about this set ("elbow twinged on rep 3"), already trimmed. */
  notes?: string | null;
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
  if (fields.score != null) assertTextLength(fields.score, MAX_SET_SCORE_LENGTH, 'score');
  if (fields.notes != null) assertTextLength(fields.notes, MAX_SET_NOTES_LENGTH, 'notes');
}

/**
 * How Postgres's `char_length` counts a text: one per character (code point), so an emoji
 * counts once — whereas JavaScript's `.length` counts it twice. Counting the server's way keeps
 * a 100-character score with an emoji in it from being refused here but accepted there.
 */
function textLength(text: string): number {
  return Array.from(text).length;
}

/** Throws a `RangeError` if `text` is longer than `max` characters, counted the server's way. */
function assertTextLength(text: string, max: number, name: string): void {
  const length = textLength(text);
  if (length > max) throw new RangeError(`${name} must be at most ${max} characters, got ${length}`);
}

/**
 * Throws a `RangeError` if a workout title is longer than the server accepts (100 characters).
 * `null` (no title) is always fine. Call it before saving a title.
 */
export function assertValidWorkoutTitle(title: string | null): void {
  if (title != null) assertTextLength(title, MAX_WORKOUT_TITLE_LENGTH, 'title');
}

/**
 * Throws a `RangeError` if a note on the whole workout is longer than the server accepts (2000
 * characters). `null` (no note) is always fine. Call it before saving the note.
 */
export function assertValidWorkoutNotes(notes: string | null): void {
  if (notes != null) assertTextLength(notes, MAX_WORKOUT_NOTES_LENGTH, 'notes');
}

/**
 * Throws a `RangeError` if a note on one exercise of a workout is longer than the server
 * accepts (1000 characters). `null` (no note) is always fine. Call it before saving the note.
 */
export function assertValidEntryNotes(notes: string | null): void {
  if (notes != null) assertTextLength(notes, MAX_ENTRY_NOTES_LENGTH, 'notes');
}

/**
 * Throws a `RangeError` unless `name` is a name the server will store for a custom exercise:
 * 1 to 80 characters (counted the server's way). Pass the name already trimmed — the phone
 * stores it trimmed, so a name of only spaces arrives here empty and is refused, which keeps a
 * blank-looking exercise out of the Library. Call it before saving a custom exercise (B31).
 */
export function assertValidExerciseName(name: string): void {
  const length = textLength(name);
  if (length < 1) throw new RangeError('name must not be empty');
  if (length > MAX_EXERCISE_NAME_LENGTH) {
    throw new RangeError(`name must be at most ${MAX_EXERCISE_NAME_LENGTH} characters, got ${length}`);
  }
}

/** Longest name of a program (`programs.name`, CHECK between 1 and 100). */
export const MAX_PROGRAM_NAME_LENGTH = 100;
/** Longest name of one workout inside a program (`program_workouts.name`, CHECK ≤ 100). */
export const MAX_PROGRAM_WORKOUT_NAME_LENGTH = 100;

/**
 * Throws a `RangeError` unless `name` is a name the server will store for a program: 1 to 100
 * characters, counted the server's way. Pass it already trimmed, so a name of only spaces is
 * refused as empty. Call it before saving a program (B34).
 */
export function assertValidProgramName(name: string): void {
  const length = textLength(name);
  if (length < 1) throw new RangeError('name must not be empty');
  if (length > MAX_PROGRAM_NAME_LENGTH) {
    throw new RangeError(`name must be at most ${MAX_PROGRAM_NAME_LENGTH} characters, got ${length}`);
  }
}

/**
 * Throws a `RangeError` if a program workout's name is longer than the server accepts (100
 * characters). `null` (no name — the workout shows as "Workout N") is always fine (B34).
 */
export function assertValidProgramWorkoutName(name: string | null): void {
  if (name != null) assertTextLength(name, MAX_PROGRAM_WORKOUT_NAME_LENGTH, 'name');
}

/**
 * One program exercise slot's prescription as it will be stored (B34): how many sets (required),
 * and optionally the reps, the load in kg and the RPE to aim for, plus its place in the workout.
 */
export interface ProgramTargetsToCheck {
  position: number;
  targetSets: number;
  targetReps?: number | null;
  /** Already rounded with `roundWeightKgForStorage`. */
  targetWeightKg?: number | null;
  /** Already rounded with `roundRpeForStorage`. */
  targetRpe?: number | null;
}

/**
 * Throws a `RangeError` naming the first target the server would refuse (sets below 1, half a
 * rep, a weight too big for its column, an RPE of 11…); returns quietly if the slot is fine.
 * The program writer calls it before every save, so a poisoned row never reaches the upload queue.
 */
export function assertValidProgramTargets(fields: ProgramTargetsToCheck): void {
  assertWholeInRange(fields.position, 0, MAX_SMALLINT, 'position');
  assertWholeInRange(fields.targetSets, 1, MAX_SMALLINT, 'targetSets');
  if (fields.targetReps != null) assertWholeInRange(fields.targetReps, 0, MAX_INTEGER, 'targetReps');
  if (fields.targetWeightKg != null) {
    assertFinite(fields.targetWeightKg, 'targetWeightKg');
    if (fields.targetWeightKg < 0 || fields.targetWeightKg >= MAX_WEIGHT_KG_EXCLUSIVE) {
      throw new RangeError(
        `targetWeightKg must be at least 0 and below ${MAX_WEIGHT_KG_EXCLUSIVE}, got ${fields.targetWeightKg}`,
      );
    }
  }
  if (fields.targetRpe != null) {
    assertFinite(fields.targetRpe, 'targetRpe');
    if (fields.targetRpe < MIN_SET_RPE || fields.targetRpe > MAX_SET_RPE) {
      throw new RangeError(`targetRpe must be from ${MIN_SET_RPE} to ${MAX_SET_RPE}, got ${fields.targetRpe}`);
    }
  }
}

/**
 * Throws a `RangeError` if `position` can't be stored as a program row's place among its siblings
 * (a smallint ≥ 0) — used for weeks and workouts, whose only number is their position (B34).
 */
export function assertValidProgramPosition(position: number): void {
  assertWholeInRange(position, 0, MAX_SMALLINT, 'position');
}

/** Longest name of a team (`teams.name`, CHECK between 1 and 80). */
export const MAX_TEAM_NAME_LENGTH = 80;

/**
 * Throws a `RangeError` unless `name` is a name the server will store for a team: 1 to 80
 * characters, counted the server's way. Pass it already trimmed, so a name of only spaces is
 * refused as empty. Teams are created online, so this mostly lets the create form say "too long"
 * before the request instead of after a refusal (B36).
 */
export function assertValidTeamName(name: string): void {
  const length = textLength(name);
  if (length < 1) throw new RangeError('name must not be empty');
  if (length > MAX_TEAM_NAME_LENGTH) {
    throw new RangeError(`name must be at most ${MAX_TEAM_NAME_LENGTH} characters, got ${length}`);
  }
}

/** Longest announcement a coach can push to a team (`team_posts.body`, CHECK between 1 and 2000). */
export const MAX_TEAM_ANNOUNCEMENT_LENGTH = 2000;

/**
 * Throws a `RangeError` unless `body` is an announcement the server will store: 1 to 2000
 * characters, counted the server's way. Pass it already trimmed, so an announcement of only
 * spaces is refused as empty. Pushes are online-only, so this lets the coach's box say "too long"
 * before the request instead of after a refusal (B37).
 */
export function assertValidTeamAnnouncement(body: string): void {
  const length = textLength(body);
  if (length < 1) throw new RangeError('announcement must not be empty');
  if (length > MAX_TEAM_ANNOUNCEMENT_LENGTH) {
    throw new RangeError(`announcement must be at most ${MAX_TEAM_ANNOUNCEMENT_LENGTH} characters, got ${length}`);
  }
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
