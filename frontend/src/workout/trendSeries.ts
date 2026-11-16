/**
 * The long-term trends on the lifter's own profile (B46, YOU-7) — the numbers behind the two
 * charts on the You tab's Trends section, read from the phone so they work with no signal.
 *
 *   - `volumeSeries`: how much weight every finished workout moved, one point per session.
 *   - `e1rmSeries`: the best estimated 1RM (Epley) of one exercise in each session it was done.
 *   - `trendExercises`: which exercises have an e1RM history at all — the chart's picker.
 *   - `filterWindow`: cut a series to the last 3 / 6 / 12 months (or keep it all).
 *
 * Why these come from raw sets and not from saved numbers: the stored PRs hold only today's best,
 * not its history, and the phone's copy of the server's analysis rows only arrives after a sync —
 * a workout finished in airplane mode would be missing from the chart. Computing from the sets
 * the phone already holds, through the one shared math module (`sessionVolumeKg`,
 * `recordsFromSets`), gives exactly the numbers the server stores and never needs a connection.
 *
 * The rules every read here follows (the `history.ts` rules): only the signed-in user's rows,
 * only finished workouts, read only, every value passed as a parameter. Times are compared through
 * `timestampMs` — the phone's rows mix "…Z" and "…+00:00" spellings, whose text doesn't sort in
 * time order.
 */
import { timestampMs } from '@analysis';
import { MAX_EPLEY_REPS, recordsFromSets, sessionVolumeKg, type PrCandidateSet } from '@training-math';

import type { SqlExecutor } from '@/db/driver';

/** One point on a trend chart: which session, when it started, and its value in kg. */
export interface TrendPoint {
  workoutId: string;
  /** The session's start, in milliseconds since 1970. */
  startedAtMs: number;
  valueKg: number;
}

/** One exercise the e1RM chart can show: its id, its name, and when it last had a qualifying set. */
export interface TrendExercise {
  exerciseId: string;
  /** The exercise's name, or null when it's no longer on the phone (the screen shows a stand-in). */
  name: string | null;
  /** When the newest session with an e1RM-qualifying set of it started (ms since 1970). */
  newestQualifyingMs: number;
}

/** How far back a chart looks: the last 3, 6 or 12 months, or every session ever logged. */
export type TrendWindow = '3m' | '6m' | '12m' | 'all';

/** The months each window reaches back. */
const WINDOW_MONTHS: Record<Exclude<TrendWindow, 'all'>, number> = { '3m': 3, '6m': 6, '12m': 12 };

/** One set row as these reads fetch it: just what the math needs, plus whose session it is in. */
interface SessionSetRow {
  workout_id: string;
  started_at: string;
  reps: number | null;
  weight_kg: number | null;
  is_warmup: number;
}

/**
 * A set as the math module reads it. `PrCandidateSet` and the volume module's `VolumeSet` are the
 * same three fields, so one shape feeds both `recordsFromSets` and `sessionVolumeKg`.
 */
type MathSet = PrCandidateSet;

/** The math module's view of a set (SQLite stores the warm-up flag as 0 / 1). */
function toMathSet(row: SessionSetRow): MathSet {
  return { reps: row.reps, weightKg: row.weight_kg == null ? null : Number(row.weight_kg), isWarmup: row.is_warmup === 1 };
}

/**
 * The joins and filters every read here shares: each set of the user's finished workouts, with its
 * session's id and start. The inner joins are what leave set-less workouts out. Its one parameter
 * is the user id; callers append their own `and …` conditions.
 */
const SESSION_SETS_FROM = `from workouts w
     join workout_exercises we on we.workout_id = w.id
     join sets s on s.workout_exercise_id = we.id
     where w.user_id = ? and w.ended_at is not null`;

/** The columns `SessionSetRow` holds. */
const SESSION_SET_COLUMNS = 'w.id as workout_id, w.started_at, s.reps, s.weight_kg, s.is_warmup';

/**
 * Groups set rows by session and turns each session into at most one point, oldest first (newest
 * on the right of the chart). `valueOf` returns undefined for a session that has no honest value —
 * that session then gets no point. Ties in start time are broken by workout id so the order never
 * flickers between reads.
 */
function sessionPoints(
  rows: readonly SessionSetRow[],
  valueOf: (sets: MathSet[]) => number | undefined,
): TrendPoint[] {
  const sessions = new Map<string, { startedAtMs: number; sets: MathSet[] }>();
  for (const row of rows) {
    const session = sessions.get(row.workout_id) ?? { startedAtMs: timestampMs(row.started_at), sets: [] };
    session.sets.push(toMathSet(row));
    sessions.set(row.workout_id, session);
  }
  const points: TrendPoint[] = [];
  for (const [workoutId, { startedAtMs, sets }] of sessions) {
    const valueKg = valueOf(sets);
    if (valueKg !== undefined && Number.isFinite(startedAtMs)) points.push({ workoutId, startedAtMs, valueKg });
  }
  return points.sort((a, b) => a.startedAtMs - b.startedAtMs || (a.workoutId < b.workoutId ? -1 : a.workoutId > b.workoutId ? 1 : 0));
}

/**
 * Every finished session's volume (reps × weight, in kg), oldest first — the Volume chart.
 *
 * Volume is `sessionVolumeKg`, the one definition the analysis screen and the server use, so
 * warm-ups and weightless sets add nothing. A session of only bodyweight or only warm-up work is
 * kept at 0: that is real training whose external load was 0, and dropping it would hide a change
 * in training. A workout finished with no sets at all is left out — it holds no training (the B42
 * rule). It reads every finished workout's sets on purpose: the chart is the lifter's whole
 * history, and it only runs while the Trends tab is open.
 */
export async function volumeSeries(db: SqlExecutor, userId: string): Promise<TrendPoint[]> {
  const rows = await db.getAllAsync<SessionSetRow>(`select ${SESSION_SET_COLUMNS} ${SESSION_SETS_FROM}`, [userId]);
  return sessionPoints(rows, (sets) => sessionVolumeKg(sets));
}

/**
 * The SQL half of "could this set give an e1RM?": weighted, 1 to `MAX_EPLEY_REPS` reps (its one
 * parameter, taken from the math module so the two can't drift), not a warm-up. It only narrows
 * what is fetched; `recordsFromSets` (the PR classifier's own rules) decides every number. It may
 * let through a set the math then ignores (fractional reps), but never drops one the math counts.
 */
const E1RM_PREFILTER = 's.weight_kg > 0 and s.reps between 1 and ? and s.is_warmup = 0';

/** The best e1RM among a session's sets of one exercise, or undefined when none qualifies. */
function bestE1rm(sets: MathSet[]): number | undefined {
  return recordsFromSets(sets).e1RmKg;
}

/**
 * One exercise's estimated 1RM over time: for each finished session that has the exercise, the
 * best Epley estimate among that session's sets — the same number the PR list would call that
 * day's e1RM, because it is the PR classifier's own fold (`recordsFromSets`) run on just that
 * session. Oldest first. A session where no set qualifies (only warm-ups, bodyweight, or more than
 * 30 reps) gets no point: an estimate has no honest zero.
 */
export async function e1rmSeries(db: SqlExecutor, userId: string, exerciseId: string): Promise<TrendPoint[]> {
  const rows = await db.getAllAsync<SessionSetRow>(
    `select ${SESSION_SET_COLUMNS} ${SESSION_SETS_FROM} and we.exercise_id = ? and ${E1RM_PREFILTER}`,
    [userId, exerciseId, MAX_EPLEY_REPS],
  );
  return sessionPoints(rows, bestE1rm);
}

/**
 * The exercises the e1RM chart can show — every exercise with at least one set that earns an
 * e1RM in a finished workout — newest first by when that last happened, so the first row is
 * "what you train now" (the chart's default). Names are looked up the way the PR list does it;
 * a deleted custom exercise is still offered, because its logged history is kept and the chart
 * is that history (its name then comes back null). Whether a set qualifies is decided by the math
 * module, set by set — the SQL only narrows the read.
 */
export async function trendExercises(db: SqlExecutor, userId: string): Promise<TrendExercise[]> {
  const rows = await db.getAllAsync<SessionSetRow & { exercise_id: string; exercise_name: string | null }>(
    // The name comes from a correlated lookup (not a join) so the shared from-clause stays as is.
    `select we.exercise_id,
       (select e.name from exercises e where e.id = we.exercise_id and (e.owner_id is null or e.owner_id = w.user_id))
         as exercise_name,
       ${SESSION_SET_COLUMNS}
     ${SESSION_SETS_FROM} and we.exercise_id is not null and ${E1RM_PREFILTER}`,
    [userId, MAX_EPLEY_REPS],
  );
  const byExercise = new Map<string, TrendExercise>();
  for (const row of rows) {
    if (bestE1rm([toMathSet(row)]) === undefined) continue;
    const ms = timestampMs(row.started_at);
    if (!Number.isFinite(ms)) continue;
    const known = byExercise.get(row.exercise_id);
    if (!known || ms > known.newestQualifyingMs) {
      byExercise.set(row.exercise_id, {
        exerciseId: row.exercise_id,
        name: typeof row.exercise_name === 'string' ? row.exercise_name : null,
        newestQualifyingMs: ms,
      });
    }
  }
  return [...byExercise.values()].sort(
    (a, b) => b.newestQualifyingMs - a.newestQualifyingMs || (a.exerciseId < b.exerciseId ? -1 : 1),
  );
}

/**
 * The moment a window starts: `months` calendar months before `nowMs`, on the phone's own clock.
 * A day that doesn't exist in the target month is pulled back to that month's last day (three
 * months before May 31 is Feb 28, not "Feb 31" = Mar 3).
 */
export function windowStartMs(months: number, nowMs: number): number {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month = now.getMonth() - months;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(
    year,
    month,
    Math.min(now.getDate(), lastDay),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  ).getTime();
}

/**
 * A series cut to a window: the points that started on or after the window's first moment
 * ('all' keeps everything). Pure — `nowMs` is passed in, so tests choose "today".
 */
export function filterWindow(points: readonly TrendPoint[], window: TrendWindow, nowMs: number): TrendPoint[] {
  if (window === 'all') return [...points];
  const start = windowStartMs(WINDOW_MONTHS[window], nowMs);
  return points.filter((p) => p.startedAtMs >= start);
}
