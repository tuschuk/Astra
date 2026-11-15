/**
 * Reading the lifter's past workouts from the phone's database — the read side of the logger.
 *
 * Three questions the logger screens ask:
 *   - `listPastWorkouts`: which workouts have I finished? (the Workout tab's list)
 *   - `readWorkout`: what exactly was in this one? (the saved-workout screen)
 *   - `lastSessionSets`: what did I do on this exercise last time? (the "last time" line, LOG-5)
 * plus `exerciseInfo`, the name (and equipment) to show for an exercise in the active workout.
 *
 * Two rules every query here follows:
 *   - **Only the signed-in user's rows.** The database file can still hold a previous account's
 *     workouts (it is kept on sign-out), so every query is filtered by `user_id`.
 *   - **Read only.** Nothing here writes; every change goes through the active-workout store or
 *     the DAO. All values are passed as parameters, never pasted into the SQL.
 */
import { fromSqlRow, TABLE_COLUMNS, type SetRow, type WorkoutExerciseRow, type WorkoutRow } from '@/db/dao';
import { placeholders, type SqlExecutor } from '@/db/driver';

/** How many past workouts the Workout tab lists (full history browsing is the profile's, B25). */
export const PAST_WORKOUT_LIMIT = 100;

/** One row of the Workout tab's history list. */
export interface PastWorkoutSummary {
  workout: WorkoutRow;
  /** How many exercises the workout has. */
  exerciseCount: number;
  /** How many sets were logged across all of them. */
  setCount: number;
}

/** One exercise of a saved workout, with its name and its sets in order. */
export interface SavedEntry extends WorkoutExerciseRow {
  /** The exercise's name, or null if it is no longer on the phone (a deleted custom exercise). */
  exerciseName: string | null;
  sets: SetRow[];
}

/** A finished workout as the saved-workout screen shows it. */
export interface SavedWorkout {
  workout: WorkoutRow;
  entries: SavedEntry[];
}

/** The previous session of one exercise: when it was, and the sets done in it. */
export interface LastSession {
  workoutId: string;
  startedAt: string;
  sets: SetRow[];
}

/** `select` list for a table's columns with a table alias, e.g. "w.id, w.user_id, …". */
function columnsOf(tbl: 'workouts' | 'workout_exercises' | 'sets', alias: string): string {
  return (TABLE_COLUMNS[tbl] as readonly string[]).map((c) => `${alias}.${c}`).join(', ');
}

/** All sets belonging to the given workout exercises, ordered by exercise then position. */
async function setsOfEntries(db: SqlExecutor, entryIds: readonly string[]): Promise<SetRow[]> {
  if (entryIds.length === 0) return [];
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `select ${columnsOf('sets', 's')} from sets s
     where s.workout_exercise_id in (${placeholders(entryIds.length)})
     order by s.position, s.id`,
    entryIds,
  );
  return rows.map((r) => fromSqlRow('sets', r));
}

/**
 * The user's finished workouts, newest first (at most `limit`, default 100), each with its
 * exercise and set counts. Workouts still in progress are never listed — they are the active
 * workout, offered as "Resume" instead.
 */
export async function listPastWorkouts(
  db: SqlExecutor,
  userId: string,
  limit: number = PAST_WORKOUT_LIMIT,
): Promise<PastWorkoutSummary[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `select ${columnsOf('workouts', 'w')},
       (select count(*) from workout_exercises we where we.workout_id = w.id) as exercise_count,
       (select count(*) from sets s join workout_exercises we on we.id = s.workout_exercise_id
          where we.workout_id = w.id) as set_count
     from workouts w
     where w.user_id = ? and w.ended_at is not null
     order by w.started_at desc, w.id desc
     limit ?`,
    [userId, limit],
  );
  return rows.map(({ exercise_count, set_count, ...workout }) => ({
    workout: fromSqlRow('workouts', workout),
    exerciseCount: Number(exercise_count),
    setCount: Number(set_count),
  }));
}

/**
 * One finished workout with every exercise (named) and every set, in the order they were
 * logged. Returns null if the workout isn't on the phone, belongs to someone else, or is still
 * in progress (an unfinished workout belongs to the logger, not this read-only view).
 */
export async function readWorkout(db: SqlExecutor, userId: string, workoutId: string): Promise<SavedWorkout | null> {
  const workoutRow = await db.getFirstAsync<Record<string, unknown>>(
    `select ${columnsOf('workouts', 'w')} from workouts w
     where w.id = ? and w.user_id = ? and w.ended_at is not null`,
    [workoutId, userId],
  );
  if (!workoutRow) return null;
  const entryRows = await db.getAllAsync<Record<string, unknown>>(
    `select ${columnsOf('workout_exercises', 'we')}, e.name as exercise_name
     from workout_exercises we
     left join exercises e on e.id = we.exercise_id and (e.owner_id is null or e.owner_id = ?)
     where we.workout_id = ?
     order by we.position, we.id`,
    [userId, workoutId],
  );
  const entries = entryRows.map(({ exercise_name, ...entry }) => ({
    ...fromSqlRow('workout_exercises', entry),
    exerciseName: typeof exercise_name === 'string' ? exercise_name : null,
  }));
  const sets = await setsOfEntries(
    db,
    entries.map((e) => e.id),
  );
  return {
    workout: fromSqlRow('workouts', workoutRow),
    entries: entries.map((e) => ({ ...e, sets: sets.filter((s) => s.workout_exercise_id === e.id) })),
  };
}

/**
 * What the lifter did on `exerciseId` the last time: the sets from their newest finished
 * workout that has at least one logged set of it, never counting `excludeWorkoutId` (the
 * workout being logged now). If the exercise appeared twice in that workout, both entries'
 * sets are returned, in workout order. Returns null when it has never been logged.
 */
export async function lastSessionSets(
  db: SqlExecutor,
  userId: string,
  exerciseId: string,
  excludeWorkoutId: string,
): Promise<LastSession | null> {
  const workout = await db.getFirstAsync<{ id: string; started_at: string }>(
    `select w.id, w.started_at from workouts w
     where w.user_id = ? and w.ended_at is not null and w.id <> ?
       and exists (
         select 1 from workout_exercises we join sets s on s.workout_exercise_id = we.id
         where we.workout_id = w.id and we.exercise_id = ?
       )
     order by w.started_at desc, w.id desc
     limit 1`,
    [userId, excludeWorkoutId, exerciseId],
  );
  if (!workout) return null;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `select ${columnsOf('sets', 's')} from sets s
     join workout_exercises we on we.id = s.workout_exercise_id
     where we.workout_id = ? and we.exercise_id = ?
     order by we.position, we.id, s.position, s.id`,
    [workout.id, exerciseId],
  );
  return { workoutId: workout.id, startedAt: workout.started_at, sets: rows.map((r) => fromSqlRow('sets', r)) };
}

/** What the logger needs to know about an exercise beyond its id. */
export interface ExerciseInfo {
  name: string;
  /** The library's equipment kind ('Barbell', 'Bodyweight', …), or null for a custom one without it. */
  equipment: string | null;
}

/**
 * The name and equipment of an exercise the user can see (a library exercise or their own), or
 * null if it isn't on the phone. The active workout stores only exercise ids, so its cards look
 * these up: the name to show, and the equipment so a bodyweight movement's weight box can ask
 * for *added* weight (LOG-15).
 */
export async function exerciseInfo(db: SqlExecutor, userId: string, exerciseId: string): Promise<ExerciseInfo | null> {
  const row = await db.getFirstAsync<{ name: string; equipment: string | null }>(
    'select name, equipment from exercises where id = ? and (owner_id is null or owner_id = ?)',
    [exerciseId, userId],
  );
  return row ? { name: row.name, equipment: row.equipment ?? null } : null;
}
