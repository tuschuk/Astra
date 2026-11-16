/**
 * A lifter's own training programs (PRG-1, PRG-2, B34) — the ONE home for every read and write
 * of the four program tables on the phone. No screen queries those tables directly.
 *
 * What a program is: a named plan made of weeks ("Week 1…N"), each holding workouts ("Day A", or
 * "Workout N" when unnamed), each holding exercise slots — a library or custom exercise plus what
 * to aim for: how many sets (required), and optionally reps, a load and an RPE. The shape is
 * enforced by construction: every add takes its parent's id, so there is no way to put an
 * exercise outside a workout or a workout outside a week.
 *
 * Why everything lives here:
 *   - Deletes are SOFT. Removing a program, week, workout or slot stamps that one row's
 *     `deleted_at` and leaves its children alone. A row counts as live only when its own stamp is
 *     empty AND every ancestor's is too, so every read must walk down from the program filtering
 *     each level. Keeping all reads here means that rule can't be forgotten at a call site.
 *   - Every write checks first: that the node belongs to the signed-in lifter and is still live
 *     (an edit must never bring a deleted row back — saving is an insert-or-update), and that every
 *     value passes the server's own rules (`@training-math` limits). A row the server refuses
 *     would sit at the front of the upload queue forever.
 *   - Every write goes through `writeLocal`, so it is saved on the phone at once (no signal
 *     needed) and queued for upload; the sync engine sends it later.
 *
 * Every read is filtered by the signed-in lifter's id: the phone's file can still hold a previous
 * account's rows.
 */
import {
  assertValidProgramName,
  assertValidProgramPosition,
  assertValidProgramTargets,
  assertValidProgramWorkoutName,
  lbToKg,
  roundRpeForStorage,
  roundWeightKgForStorage,
  type WeightUnit,
} from '@training-math';

import type { SqlDriver, SqlExecutor } from '@/db/driver';
import {
  fromSqlRow,
  TABLE_COLUMNS,
  writeLocal,
  type ProgramExerciseRow,
  type ProgramRow,
  type ProgramTable,
  type ProgramVisibility,
  type ProgramWeekRow,
  type ProgramWorkoutRow,
  type RowByTable,
} from '@/db/dao';
import { newUuid } from '@/lib/ids';
import { formatWeight } from '@/workout/format';

/** Shown for a slot whose exercise no longer exists on the phone (hard-deleted, or never visible). */
export const DELETED_EXERCISE_NAME = 'Deleted exercise';

/** Options every writer takes: an injectable clock and id maker, so tests are repeatable. */
export interface ProgramWriteOptions {
  /** The current time as ISO-8601 text. */
  now?: string;
  /** Makes the id of a newly added row (add / create only). */
  newId?: () => string;
}

/**
 * What the lifter typed for one exercise slot's targets. `weight` is in the unit they typed it
 * in; it is converted to kg (and rounded to the server's 2 decimals) before it is saved.
 */
export interface ProgramTargetsInput {
  /** How many sets — required, at least 1. */
  sets: number;
  reps: number | null;
  weight: { value: number; unit: WeightUnit } | null;
  rpe: number | null;
}

/** One program in the list: the row plus how big it is (live weeks, live workouts in them). */
export interface ProgramSummary {
  program: ProgramRow;
  weekCount: number;
  workoutCount: number;
}

/** One exercise slot as the editor and B35 read it: the row and the exercise's name. */
export interface ProgramExerciseNode {
  slot: ProgramExerciseRow;
  /** The exercise's name, or `DELETED_EXERCISE_NAME` if it can't be found. */
  exerciseName: string;
}

/** One workout of a week, with its live exercise slots in order. */
export interface ProgramWorkoutNode {
  workout: ProgramWorkoutRow;
  /** 1-based place within its week (what "Workout N" counts). */
  number: number;
  /** Its name, or "Workout N" when it has none. */
  label: string;
  exercises: ProgramExerciseNode[];
}

/** One week of a program, with its live workouts in order. */
export interface ProgramWeekNode {
  week: ProgramWeekRow;
  /** 1-based place within the program ("Week N"). */
  number: number;
  workouts: ProgramWorkoutNode[];
}

/** A whole live program: the row and every live week, workout and slot under it, in order. */
export interface ProgramTree {
  program: ProgramRow;
  weeks: ProgramWeekNode[];
}

/** "p.id, p.user_id, …" — a table's columns prefixed with a query alias. */
function cols(tbl: ProgramTable, alias: string): string {
  return (TABLE_COLUMNS[tbl] as readonly string[]).map((c) => `${alias}.${c}`).join(', ');
}

/** The lookup that proves a node is the lifter's and live all the way up, per table. */
const LIVE_NODE_SQL: { [T in ProgramTable]: string } = {
  programs: `select ${cols('programs', 'p')} from programs p where p.id = ? and p.user_id = ? and p.deleted_at is null`,
  program_weeks:
    `select ${cols('program_weeks', 'w')} from program_weeks w join programs p on p.id = w.program_id ` +
    'where w.id = ? and p.user_id = ? and w.deleted_at is null and p.deleted_at is null',
  program_workouts:
    `select ${cols('program_workouts', 'pw')} from program_workouts pw ` +
    'join program_weeks w on w.id = pw.program_week_id join programs p on p.id = w.program_id ' +
    'where pw.id = ? and p.user_id = ? and pw.deleted_at is null and w.deleted_at is null and p.deleted_at is null',
  program_exercises:
    `select ${cols('program_exercises', 'pe')} from program_exercises pe ` +
    'join program_workouts pw on pw.id = pe.program_workout_id ' +
    'join program_weeks w on w.id = pw.program_week_id join programs p on p.id = w.program_id ' +
    'where pe.id = ? and p.user_id = ? and pe.deleted_at is null and pw.deleted_at is null ' +
    'and w.deleted_at is null and p.deleted_at is null',
};

/** Row type per program table, for `requireLive`. */
type ProgramRowByTable = Pick<RowByTable, ProgramTable>;

/** The node `id` of `tbl` if it is the lifter's and live all the way up to its program, else null. */
async function findLive<T extends ProgramTable>(
  db: SqlExecutor,
  tbl: T,
  userId: string,
  id: string,
): Promise<ProgramRowByTable[T] | null> {
  const raw = await db.getFirstAsync<Record<string, unknown>>(LIVE_NODE_SQL[tbl], [id, userId]);
  return raw ? (fromSqlRow(tbl, raw) as unknown as ProgramRowByTable[T]) : null;
}

/** Like `findLive`, but throws when the node is missing, someone else's, or deleted (here or above). */
async function requireLive<T extends ProgramTable>(
  db: SqlExecutor,
  tbl: T,
  userId: string,
  id: string,
): Promise<ProgramRowByTable[T]> {
  const row = await findLive(db, tbl, userId, id);
  if (!row) throw new Error(`${tbl} ${id} is not a live part of one of this lifter's programs`);
  return row;
}

/**
 * Removes one node of the lifter's program — the program itself, a week, a workout or a slot —
 * by stamping its own `deleted_at` (a SOFT delete: the row stays and its children are left
 * alone; every read hides it and everything under it). Refuses (throws) a node that is not the
 * lifter's, or is already gone here or above.
 */
async function softRemove(
  db: SqlDriver,
  tbl: ProgramTable,
  userId: string,
  id: string,
  options: ProgramWriteOptions,
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  const current = await requireLive(db, tbl, userId, id);
  await writeLocal(db, tbl, [{ ...current, deleted_at: now, updated_at: now }] as RowByTable[typeof tbl][], { now });
}

/**
 * The next free position among a parent's live children: one past the highest, or 0 when there
 * are none. `childTable` / `parentColumn` name the sibling set (fixed strings, never user input).
 */
async function nextPosition(
  db: SqlExecutor,
  childTable: 'program_weeks' | 'program_workouts' | 'program_exercises',
  parentColumn: string,
  parentId: string,
): Promise<number> {
  const row = await db.getFirstAsync<{ top: number | null }>(
    `select max(position) as top from ${childTable} where ${parentColumn} = ? and deleted_at is null`,
    [parentId],
  );
  return row?.top == null ? 0 : row.top + 1;
}

/** Trims a program name and refuses one the server would refuse (empty, or over 100 characters). */
function cleanProgramName(name: string): string {
  const trimmed = name.trim();
  assertValidProgramName(trimmed);
  return trimmed;
}

/** Trims a workout name; blank becomes null ("Workout N"); over 100 characters is refused. */
function cleanWorkoutName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim();
  const value = trimmed === '' ? null : trimmed;
  assertValidProgramWorkoutName(value);
  return value;
}

/**
 * Turns typed targets into stored columns: weight converted to kg and rounded to the server's 2
 * decimals, RPE to its 1 decimal, then everything checked against the server's rules (throws a
 * `RangeError` naming the field before anything is saved).
 */
function targetColumns(targets: ProgramTargetsInput, position: number) {
  const targetWeightKg =
    targets.weight == null
      ? null
      : roundWeightKgForStorage(targets.weight.unit === 'lb' ? lbToKg(targets.weight.value) : targets.weight.value);
  const targetRpe = targets.rpe == null ? null : roundRpeForStorage(targets.rpe);
  assertValidProgramTargets({
    position,
    targetSets: targets.sets,
    targetReps: targets.reps,
    targetWeightKg,
    targetRpe,
  });
  return {
    position,
    target_sets: targets.sets,
    target_reps: targets.reps,
    target_weight_kg: targetWeightKg,
    target_rpe: targetRpe,
  };
}

// ---------------------------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------------------------

/**
 * Creates a new, empty program for the signed-in lifter and returns it. The name is trimmed and
 * must be 1–100 characters (a `RangeError` otherwise). Saved and queued in one step, so it works
 * with no signal.
 */
export async function createProgram(
  db: SqlDriver,
  userId: string,
  name: string,
  options: ProgramWriteOptions = {},
): Promise<ProgramRow> {
  const clean = cleanProgramName(name);
  const now = options.now ?? new Date().toISOString();
  const row: ProgramRow = {
    id: (options.newId ?? newUuid)(),
    user_id: userId,
    name: clean,
    // Born private: the lifter shares a program deliberately, never by default.
    visibility: 'private',
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  await writeLocal(db, 'programs', [row], { now });
  return row;
}

/**
 * The words the program page shows for each visibility level: a short chip label and one
 * sentence saying who can see the program. One table so the screen and its tests agree. (Kept
 * apart from the workout/post `VISIBILITY_WORDS` because the levels differ: programs have Team and
 * Published, posts don't.)
 */
export const PROGRAM_VISIBILITY_WORDS: { [V in ProgramVisibility]: { label: string; meaning: string } } = {
  private: { label: 'Only you', meaning: 'Only you can see this program.' },
  followers: { label: 'Followers', meaning: 'Your followers can see this program.' },
  team: { label: 'Team', meaning: 'Members of the Teams you share it with can see this program.' },
  published: {
    label: 'Published',
    meaning: 'Anyone on Astra can see this program — it is listed on the Marketplace.',
  },
};

/** The visibility levels in the order the chips show them, most private first. */
export const PROGRAM_VISIBILITY_ORDER: readonly ProgramVisibility[] = ['private', 'followers', 'team', 'published'];

/**
 * Changes who besides the lifter may see one of their live programs, and returns the saved row.
 * Saved on the phone at once and queued for upload, so it works with no signal; the server's
 * security rules are what actually enforce the choice once it syncs. Refuses (throws) a program
 * that is not the lifter's or is deleted. Which Teams a 'team' program is shared with is a
 * separate, online-only list (`social/programShares.ts`).
 */
export async function setProgramVisibility(
  db: SqlDriver,
  userId: string,
  programId: string,
  visibility: ProgramVisibility,
  options: ProgramWriteOptions = {},
): Promise<ProgramRow> {
  if (!PROGRAM_VISIBILITY_ORDER.includes(visibility)) throw new RangeError(`Unknown program visibility ${visibility}`);
  const now = options.now ?? new Date().toISOString();
  const current = await requireLive(db, 'programs', userId, programId);
  const row: ProgramRow = { ...current, visibility, updated_at: now };
  await writeLocal(db, 'programs', [row], { now });
  return row;
}

/** Renames one of the lifter's live programs (trimmed, 1–100 characters) and returns the saved row. */
export async function renameProgram(
  db: SqlDriver,
  userId: string,
  programId: string,
  name: string,
  options: ProgramWriteOptions = {},
): Promise<ProgramRow> {
  const clean = cleanProgramName(name);
  const now = options.now ?? new Date().toISOString();
  const current = await requireLive(db, 'programs', userId, programId);
  const row: ProgramRow = { ...current, name: clean, updated_at: now };
  await writeLocal(db, 'programs', [row], { now });
  return row;
}

/** Deletes one of the lifter's programs (soft: the row is stamped and hidden everywhere). */
export async function deleteProgram(
  db: SqlDriver,
  userId: string,
  programId: string,
  options: ProgramWriteOptions = {},
): Promise<void> {
  await softRemove(db, 'programs', userId, programId, options);
}

/** One of the lifter's live programs, or null (unknown, someone else's, or deleted). */
export function getProgram(db: SqlExecutor, userId: string, programId: string): Promise<ProgramRow | null> {
  return findLive(db, 'programs', userId, programId);
}

/**
 * Every live program of the lifter, newest first, each with its number of live weeks and of live
 * workouts inside those weeks — what the Programs list shows.
 */
export async function listPrograms(db: SqlExecutor, userId: string): Promise<ProgramSummary[]> {
  const raw = await db.getAllAsync<Record<string, unknown> & { week_count: number; workout_count: number }>(
    `select ${cols('programs', 'p')},
       (select count(*) from program_weeks w where w.program_id = p.id and w.deleted_at is null) as week_count,
       (select count(*) from program_workouts pw join program_weeks w on w.id = pw.program_week_id
          where w.program_id = p.id and w.deleted_at is null and pw.deleted_at is null) as workout_count
     from programs p
     where p.user_id = ? and p.deleted_at is null
     order by p.created_at desc, p.id desc`,
    [userId],
  );
  return raw.map(({ week_count, workout_count, ...row }) => ({
    program: fromSqlRow('programs', row),
    weekCount: week_count,
    workoutCount: workout_count,
  }));
}

// ---------------------------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------------------------

/** Adds a week at the end of one of the lifter's live programs and returns it. */
export async function addWeek(
  db: SqlDriver,
  userId: string,
  programId: string,
  options: ProgramWriteOptions = {},
): Promise<ProgramWeekRow> {
  await requireLive(db, 'programs', userId, programId);
  const now = options.now ?? new Date().toISOString();
  const position = await nextPosition(db, 'program_weeks', 'program_id', programId);
  assertValidProgramPosition(position);
  const row: ProgramWeekRow = {
    id: (options.newId ?? newUuid)(),
    program_id: programId,
    position,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  await writeLocal(db, 'program_weeks', [row], { now });
  return row;
}

/** Removes a week (soft: only the week is stamped; its workouts vanish with it from every read). */
export async function removeWeek(
  db: SqlDriver,
  userId: string,
  weekId: string,
  options: ProgramWriteOptions = {},
): Promise<void> {
  await softRemove(db, 'program_weeks', userId, weekId, options);
}

// ---------------------------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------------------------

/**
 * Adds a workout at the end of a live week of the lifter's and returns it. `name` is optional:
 * blank or missing shows as "Workout N"; over 100 characters is refused.
 */
export async function addProgramWorkout(
  db: SqlDriver,
  userId: string,
  weekId: string,
  name: string | null = null,
  options: ProgramWriteOptions = {},
): Promise<ProgramWorkoutRow> {
  const clean = cleanWorkoutName(name);
  await requireLive(db, 'program_weeks', userId, weekId);
  const now = options.now ?? new Date().toISOString();
  const position = await nextPosition(db, 'program_workouts', 'program_week_id', weekId);
  assertValidProgramPosition(position);
  const row: ProgramWorkoutRow = {
    id: (options.newId ?? newUuid)(),
    program_week_id: weekId,
    name: clean,
    position,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  await writeLocal(db, 'program_workouts', [row], { now });
  return row;
}

/** Renames a live program workout; a blank name clears it back to "Workout N". Returns the saved row. */
export async function renameProgramWorkout(
  db: SqlDriver,
  userId: string,
  workoutId: string,
  name: string | null,
  options: ProgramWriteOptions = {},
): Promise<ProgramWorkoutRow> {
  const clean = cleanWorkoutName(name);
  const now = options.now ?? new Date().toISOString();
  const current = await requireLive(db, 'program_workouts', userId, workoutId);
  const row: ProgramWorkoutRow = { ...current, name: clean, updated_at: now };
  await writeLocal(db, 'program_workouts', [row], { now });
  return row;
}

/** Removes a program workout (soft: only the workout is stamped). */
export async function removeProgramWorkout(
  db: SqlDriver,
  userId: string,
  workoutId: string,
  options: ProgramWriteOptions = {},
): Promise<void> {
  await softRemove(db, 'program_workouts', userId, workoutId, options);
}

// ---------------------------------------------------------------------------------------------
// Exercise slots
// ---------------------------------------------------------------------------------------------

/**
 * Throws unless `exerciseId` is an exercise this lifter can use: a library exercise or one of their
 * own live customs, on this phone. Why: the server refuses a slot naming an exercise it doesn't
 * hold (its foreign key), and that refusal would block the upload queue for good.
 */
async function assertUsableExercise(db: SqlExecutor, userId: string, exerciseId: string): Promise<void> {
  const found = await db.getFirstAsync<{ id: string }>(
    'select id from exercises where id = ? and (owner_id is null or owner_id = ?) and deleted_at is null',
    [exerciseId, userId],
  );
  if (!found) throw new Error(`Exercise ${exerciseId} is not a library or live custom exercise of this lifter`);
}

/**
 * Adds an exercise slot at the end of a live program workout of the lifter's, with its targets,
 * and returns it. `exerciseId` is the id the exercise picker reports (library or custom).
 * Throws a `RangeError` for a target the server would refuse (0 sets, half a rep, RPE 11…).
 */
export async function addProgramExercise(
  db: SqlDriver,
  userId: string,
  workoutId: string,
  input: { exerciseId: string; targets: ProgramTargetsInput },
  options: ProgramWriteOptions = {},
): Promise<ProgramExerciseRow> {
  await requireLive(db, 'program_workouts', userId, workoutId);
  await assertUsableExercise(db, userId, input.exerciseId);
  const now = options.now ?? new Date().toISOString();
  const position = await nextPosition(db, 'program_exercises', 'program_workout_id', workoutId);
  const row: ProgramExerciseRow = {
    id: (options.newId ?? newUuid)(),
    program_workout_id: workoutId,
    exercise_id: input.exerciseId,
    ...targetColumns(input.targets, position),
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  await writeLocal(db, 'program_exercises', [row], { now });
  return row;
}

/** Replaces a live slot's targets (its exercise and place stay) and returns the saved row. */
export async function updateProgramExercise(
  db: SqlDriver,
  userId: string,
  slotId: string,
  targets: ProgramTargetsInput,
  options: ProgramWriteOptions = {},
): Promise<ProgramExerciseRow> {
  const current = await requireLive(db, 'program_exercises', userId, slotId);
  const now = options.now ?? new Date().toISOString();
  const row: ProgramExerciseRow = { ...current, ...targetColumns(targets, current.position), updated_at: now };
  await writeLocal(db, 'program_exercises', [row], { now });
  return row;
}

/** Removes an exercise slot (soft: the slot is stamped and hidden). */
export async function removeProgramExercise(
  db: SqlDriver,
  userId: string,
  slotId: string,
  options: ProgramWriteOptions = {},
): Promise<void> {
  await softRemove(db, 'program_exercises', userId, slotId, options);
}

/** Live slots of one workout in display order (position, then id — the same on every phone). */
async function liveSlots(db: SqlExecutor, workoutId: string): Promise<ProgramExerciseRow[]> {
  const raw = await db.getAllAsync<Record<string, unknown>>(
    `select ${cols('program_exercises', 'pe')} from program_exercises pe
     where pe.program_workout_id = ? and pe.deleted_at is null order by pe.position, pe.id`,
    [workoutId],
  );
  return raw.map((r) => fromSqlRow('program_exercises', r));
}

/**
 * Moves a slot one place up or down within its workout. Does nothing at the top / bottom.
 *
 * How: the workout's live slots are put in their new order and numbered 0, 1, 2… — and only the
 * slots whose number actually changed are saved. A plain swap of two positions would do nothing
 * when two slots tie (two adds made offline on different phones can land on the same number);
 * renumbering fixes ties and gaps along the way, usually touching just the two swapped slots.
 */
export async function moveProgramExercise(
  db: SqlDriver,
  userId: string,
  slotId: string,
  direction: 'up' | 'down',
  options: ProgramWriteOptions = {},
): Promise<void> {
  const current = await requireLive(db, 'program_exercises', userId, slotId);
  const slots = await liveSlots(db, current.program_workout_id);
  const from = slots.findIndex((s) => s.id === slotId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= slots.length) return;
  const reordered = [...slots];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  const changed = reordered
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => slot.position !== index)
    .map(({ slot, index }) => {
      assertValidProgramPosition(index);
      return { ...slot, position: index };
    });
  if (changed.length === 0) return;
  await writeLocal(db, 'program_exercises', changed, { now: options.now });
}

// ---------------------------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------------------------

/**
 * The whole live program `programId` of the lifter — weeks, their workouts, their exercise slots,
 * each level ordered by (position, id) so every phone shows the same order even when two offline
 * adds tied — or null if the program is unknown, someone else's, or deleted.
 *
 * Deleted weeks, workouts and slots are left out, and so is everything under a deleted node.
 * Exercise names come from the phone's `exercises` table, limited to the library and this
 * lifter's own customs (a deleted custom still names itself — the lifter chose it); a slot whose
 * exercise can't be found reads "Deleted exercise". This is the one read the program page, the
 * workout editor and (B35) the logger's prefill share.
 */
export async function readProgramTree(db: SqlExecutor, userId: string, programId: string): Promise<ProgramTree | null> {
  const program = await findLive(db, 'programs', userId, programId);
  if (!program) return null;

  const weeks = (
    await db.getAllAsync<Record<string, unknown>>(
      `select ${cols('program_weeks', 'w')} from program_weeks w
       where w.program_id = ? and w.deleted_at is null order by w.position, w.id`,
      [programId],
    )
  ).map((r) => fromSqlRow('program_weeks', r));

  const workouts = (
    await db.getAllAsync<Record<string, unknown>>(
      `select ${cols('program_workouts', 'pw')} from program_workouts pw
       join program_weeks w on w.id = pw.program_week_id
       where w.program_id = ? and w.deleted_at is null and pw.deleted_at is null
       order by pw.position, pw.id`,
      [programId],
    )
  ).map((r) => fromSqlRow('program_workouts', r));

  const slots = await db.getAllAsync<Record<string, unknown> & { exercise_name: string | null }>(
    `select ${cols('program_exercises', 'pe')}, e.name as exercise_name from program_exercises pe
     join program_workouts pw on pw.id = pe.program_workout_id
     join program_weeks w on w.id = pw.program_week_id
     left join exercises e on e.id = pe.exercise_id and (e.owner_id is null or e.owner_id = ?)
     where w.program_id = ? and w.deleted_at is null and pw.deleted_at is null and pe.deleted_at is null
     order by pe.position, pe.id`,
    [userId, programId],
  );

  const slotsByWorkout = new Map<string, ProgramExerciseNode[]>();
  for (const { exercise_name, ...raw } of slots) {
    const slot = fromSqlRow('program_exercises', raw);
    const list = slotsByWorkout.get(slot.program_workout_id) ?? [];
    list.push({ slot, exerciseName: exercise_name ?? DELETED_EXERCISE_NAME });
    slotsByWorkout.set(slot.program_workout_id, list);
  }

  return {
    program,
    weeks: weeks.map((week, weekIndex) => ({
      week,
      number: weekIndex + 1,
      workouts: workouts
        .filter((w) => w.program_week_id === week.id)
        .map((workout, index) => ({
          workout,
          number: index + 1,
          label: workout.name ?? `Workout ${index + 1}`,
          exercises: slotsByWorkout.get(workout.id) ?? [],
        })),
    })),
  };
}

/** One program workout located inside its live program: the whole tree, its week and itself. */
export interface ProgramWorkoutLocation {
  tree: ProgramTree;
  week: ProgramWeekNode;
  workout: ProgramWorkoutNode;
}

/**
 * Finds live program workout `workoutId` of the lifter inside its program's tree (so its label
 * and slots match the program page exactly), or null if it — or its week or program — is
 * unknown, someone else's, or deleted. What the workout editor screen reads.
 */
export async function readProgramWorkout(
  db: SqlExecutor,
  userId: string,
  workoutId: string,
): Promise<ProgramWorkoutLocation | null> {
  const workout = await findLive(db, 'program_workouts', userId, workoutId);
  if (!workout) return null;
  const week = await db.getFirstAsync<{ program_id: string }>('select program_id from program_weeks where id = ?', [
    workout.program_week_id,
  ]);
  if (!week) return null;
  const tree = await readProgramTree(db, userId, week.program_id);
  if (!tree) return null;
  for (const weekNode of tree.weeks) {
    const node = weekNode.workouts.find((w) => w.workout.id === workoutId);
    if (node) return { tree, week: weekNode, workout: node };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------------

/**
 * A slot's targets as one short line, weight in the lifter's unit:
 *   "3 × 8 @ 135 lb · RPE 8", "3 × 8", "3 sets @ 60 kg", "1 set", "4 × 5 · RPE 7.5".
 */
export function formatProgramTargets(
  slot: Pick<ProgramExerciseRow, 'target_sets' | 'target_reps' | 'target_weight_kg' | 'target_rpe'>,
  unit: WeightUnit,
): string {
  const volume =
    slot.target_reps != null
      ? `${slot.target_sets} × ${slot.target_reps}`
      : `${slot.target_sets} ${slot.target_sets === 1 ? 'set' : 'sets'}`;
  const load = slot.target_weight_kg != null ? ` @ ${formatWeight(slot.target_weight_kg, unit)}` : '';
  const rpe = slot.target_rpe != null ? ` · RPE ${slot.target_rpe}` : '';
  return `${volume}${load}${rpe}`;
}

/** "2 weeks · 5 workouts" (singular for one) — the Programs list's size line. */
export function formatProgramSize(summary: Pick<ProgramSummary, 'weekCount' | 'workoutCount'>): string {
  const weeks = `${summary.weekCount} ${summary.weekCount === 1 ? 'week' : 'weeks'}`;
  const workouts = `${summary.workoutCount} ${summary.workoutCount === 1 ? 'workout' : 'workouts'}`;
  return `${weeks} · ${workouts}`;
}
