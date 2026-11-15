/**
 * A lifter's own custom exercises (LIB-5, B31) — the one home for creating, editing, deleting,
 * listing and filtering them on the phone.
 *
 * What a custom exercise is: a row in the phone's `exercises` table with `owner_id` set to the
 * lifter (library rows have none) and no `slug`. It has a name and, optionally, the kind of
 * equipment and the main muscle — the same words the bundled library uses, so the Library's
 * filter chips can match it. It is logged, gets PRs and history exactly like a library exercise,
 * because everything downstream keys on the exercise's id, never on where it came from.
 *
 * Every write goes through `writeLocal`, so it is saved on the phone at once (no signal needed)
 * and queued for upload; the sync engine sends it to the server later. The server's row-level
 * security keeps it private: no other user can read, change or delete it.
 *
 * Deleting is a SOFT delete: `deleted_at` is stamped and the row stays. That keeps the lifter's
 * logged sessions and PRs naming the exercise, and makes the delete an ordinary edit that syncs
 * the usual way (see docs/feature_plans/custom-exercises.md for the full reasoning).
 *
 * The deleted filter lives here and only here. The readers in this file hide deleted customs —
 * they feed the Library and the logger's picker, where a deleted exercise must vanish. The
 * history and PR readers elsewhere (`workout/history.ts`, `workout/prs.ts`, `analysis/`)
 * deliberately do NOT filter, so a past session of a since-deleted exercise still shows its name.
 *
 * Every read is filtered by the signed-in lifter's id: the phone's file can still hold a previous
 * account's rows.
 */
import { assertValidExerciseName } from '@training-math';

import type { SqlExecutor, SqlDriver } from '@/db/driver';
import { TABLE_COLUMNS, writeLocal, fromSqlRow, type ExerciseRow } from '@/db/dao';
import { newUuid } from '@/lib/ids';

import type { BodyRegion } from './catalog';
import type { Equipment, MuscleKey } from './exercises';

/** What the lifter types into the create / edit form. */
export interface CustomExerciseInput {
  /** The exercise's name; trimmed before it is saved, and must be 1–80 characters after that. */
  name: string;
  /** The kind of equipment it uses, or null if the lifter didn't say. */
  equipment: Equipment | null;
  /** The main muscle it trains, as a muscle key ('chest'), or null if the lifter didn't say. */
  primaryMuscle: MuscleKey | null;
}

/** Options shared by the writers: an injectable clock (tests) and id maker (tests). */
export interface CustomExerciseWriteOptions {
  /** The current time as ISO-8601 text. */
  now?: string;
  /** Makes the new exercise's id (create only). */
  newId?: () => string;
}

/** The columns read back for an exercise, in the device table's names. */
const COLUMNS = (TABLE_COLUMNS.exercises as readonly string[]).join(', ');

/**
 * Checks and tidies the form's input: trims the name and refuses a name the server would refuse
 * (empty or over 80 characters) with a `RangeError`. The check happens before anything is saved,
 * because a row the server refuses would sit at the front of the upload queue forever.
 */
function cleanInput(input: CustomExerciseInput): CustomExerciseInput {
  const name = input.name.trim();
  assertValidExerciseName(name);
  return { name, equipment: input.equipment, primaryMuscle: input.primaryMuscle };
}

/** Reads one exercise row the lifter owns (deleted or not), or null. */
async function getOwnedRow(db: SqlExecutor, userId: string, id: string): Promise<ExerciseRow | null> {
  const raw = await db.getFirstAsync<Record<string, unknown>>(
    `select ${COLUMNS} from exercises where id = ? and owner_id = ?`,
    [id, userId],
  );
  return raw ? fromSqlRow('exercises', raw) : null;
}

/** Reads one exercise the lifter owns and can still change; throws if it's missing or deleted. */
async function requireLiveRow(db: SqlExecutor, userId: string, id: string): Promise<ExerciseRow> {
  const row = await getOwnedRow(db, userId, id);
  if (!row) throw new Error(`Exercise ${id} is not one of this lifter's custom exercises`);
  if (row.deleted_at !== null) throw new Error(`Exercise ${id} has been deleted`);
  return row;
}

/**
 * Creates a new custom exercise for the signed-in lifter and returns the saved row.
 *
 * Input: the database, the lifter's id, and the form's name / equipment / muscle. The new row gets
 * a fresh random id, `owner_id` = this lifter (the only owner this code ever writes) and no slug —
 * the server only allows slugs on library rows. Saved and queued for upload in one step, so it
 * works offline. Throws a `RangeError` for a name the server would refuse.
 */
export async function createCustomExercise(
  db: SqlDriver,
  userId: string,
  input: CustomExerciseInput,
  options: CustomExerciseWriteOptions = {},
): Promise<ExerciseRow> {
  const clean = cleanInput(input);
  const now = options.now ?? new Date().toISOString();
  const row: ExerciseRow = {
    id: (options.newId ?? newUuid)(),
    owner_id: userId,
    name: clean.name,
    primary_muscle: clean.primaryMuscle,
    equipment: clean.equipment,
    slug: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  await writeLocal(db, 'exercises', [row], { now });
  return row;
}

/**
 * Changes the name / equipment / muscle of one of the lifter's custom exercises and returns the
 * saved row. Refuses (throws) if the exercise isn't theirs, doesn't exist, or was deleted — the
 * last matters because saving is an insert-or-update, and an edit must never bring a deleted
 * exercise back. Throws a `RangeError` for a name the server would refuse.
 */
export async function updateCustomExercise(
  db: SqlDriver,
  userId: string,
  id: string,
  input: CustomExerciseInput,
  options: CustomExerciseWriteOptions = {},
): Promise<ExerciseRow> {
  const clean = cleanInput(input);
  const now = options.now ?? new Date().toISOString();
  const current = await requireLiveRow(db, userId, id);
  const row: ExerciseRow = {
    ...current,
    name: clean.name,
    equipment: clean.equipment,
    primary_muscle: clean.primaryMuscle,
    updated_at: now,
  };
  await writeLocal(db, 'exercises', [row], { now });
  return row;
}

/**
 * Deletes one of the lifter's custom exercises: it disappears from the Library and the logger's
 * picker on every phone of theirs. The row itself is kept with a `deleted_at` stamp (a soft
 * delete — see the file comment), so their past sessions and PRs keep its name. Refuses (throws)
 * if the exercise isn't theirs, doesn't exist, or is already deleted.
 */
export async function deleteCustomExercise(
  db: SqlDriver,
  userId: string,
  id: string,
  options: CustomExerciseWriteOptions = {},
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  const current = await requireLiveRow(db, userId, id);
  await writeLocal(db, 'exercises', [{ ...current, deleted_at: now, updated_at: now }], { now });
}

/** Every live (not deleted) custom exercise of the lifter, ordered by name (ignoring case). */
export async function listCustomExercises(db: SqlExecutor, userId: string): Promise<ExerciseRow[]> {
  const raw = await db.getAllAsync<Record<string, unknown>>(
    `select ${COLUMNS} from exercises where owner_id = ? and deleted_at is null order by name collate nocase, id`,
    [userId],
  );
  return raw.map((r) => fromSqlRow('exercises', r));
}

/**
 * One live custom exercise of the lifter, or null — when the id is unknown, is someone else's, is
 * a library exercise, or was deleted. Used by the exercise card screen.
 */
export async function getCustomExercise(db: SqlExecutor, userId: string, id: string): Promise<ExerciseRow | null> {
  const row = await getOwnedRow(db, userId, id);
  return row && row.deleted_at === null ? row : null;
}

/** The Library tab's active search and chips, as applied to custom exercises. */
export interface CustomExerciseFilters {
  query?: string;
  body?: BodyRegion | null;
  muscle?: MuscleKey | null;
  equipment?: Equipment | null;
}

/**
 * Narrows the lifter's custom exercises by the Library tab's search box and chips, so the "Your
 * exercises" section obeys the same controls as the catalog below it.
 *
 * Rules: the search is a case-insensitive "name contains" match (customs have no alternative
 * names); the equipment chip matches the custom's equipment exactly; the muscle chip matches its
 * main muscle exactly. A body-region chip (Upper / Lower / Core / Cardio) hides every custom:
 * customs carry no region, and showing them anyway would claim a match that isn't there. Order is
 * kept as given.
 */
export function filterCustomExercises(
  rows: readonly ExerciseRow[],
  filters: CustomExerciseFilters,
): readonly ExerciseRow[] {
  if (filters.body) return [];
  const q = (filters.query ?? '').trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q)) &&
      (!filters.equipment || r.equipment === filters.equipment) &&
      (!filters.muscle || r.primary_muscle === filters.muscle),
  );
}
