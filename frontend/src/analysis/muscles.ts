/**
 * The muscle map's data on the phone (ANA-3): which muscles one finished workout trained, and how
 * directly, read entirely from the phone's own database plus the bundled exercise library — so it
 * works offline the moment the workout is finished.
 *
 * How it decides: an exercise counts only if at least one set was logged for it (warm-ups, timed
 * and score-only sets all count — they were still performed; an exercise added but never done
 * trained nothing). Each counted exercise is matched back to its library entry through the slug
 * the library seed wrote into the phone's exercise row, and its muscle table comes from there.
 * The tables are then merged by the shared rule (`combineMuscleLoads`, the one home of that rule).
 *
 * Custom exercises (no slug) and any exercise the bundled library no longer knows add nothing:
 * the library is the only muscle data that exists, and guessing from a free-text muscle label
 * would invent numbers (plan decision G4).
 */
import { combineMuscleLoads } from '@analysis';

import type { SqlExecutor } from '@/db/driver';
import { ALL_EXERCISES, type ExerciseDef } from '@/library/catalog';
import type { MuscleKey } from '@/library/exercises';

/** A session's muscle map: each trained muscle → how directly it was trained, in (0, 1]. Untrained muscles are absent. */
export type SessionMuscleLoads = Partial<Record<MuscleKey, number>>;

/** The library by slug ('bench_press' → its entry), built once. */
const CATALOG_BY_SLUG: ReadonlyMap<string, ExerciseDef> = new Map(ALL_EXERCISES.map((e) => [e.id, e]));

/**
 * The muscle map of one of the user's workouts.
 *
 * Input: the phone's database, the signed-in user's id, and the workout's id. Output: the merged
 * muscle table of every library exercise that has at least one logged set — empty when the
 * workout isn't the user's, isn't on this phone, or has nothing mapped in it.
 */
export async function sessionMuscleLoads(db: SqlExecutor, userId: string, workoutId: string): Promise<SessionMuscleLoads> {
  const rows = await db.getAllAsync<{ slug: string }>(
    `select distinct e.slug as slug
     from workouts w
     join workout_exercises we on we.workout_id = w.id
     join exercises e on e.id = we.exercise_id
     where w.id = ? and w.user_id = ?
       and e.slug is not null
       and (e.owner_id is null or e.owner_id = ?)
       and exists (select 1 from sets s where s.workout_exercise_id = we.id)`,
    [workoutId, userId, userId],
  );
  const tables = rows
    .map((r) => CATALOG_BY_SLUG.get(r.slug)?.muscles)
    .filter((m): m is ExerciseDef['muscles'] => m !== undefined);
  return combineMuscleLoads<MuscleKey>(tables);
}
