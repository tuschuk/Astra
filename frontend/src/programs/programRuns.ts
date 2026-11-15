/**
 * Running a program (PRG-3, B35) — the ONE home for every read and write of `program_runs` on the
 * phone. No screen or other module queries that table directly.
 *
 * What a run is: "I am doing this program, and my next session is that one". The lifter starts a
 * run from the Workout tab; from then on the tab's main button starts the run's next session,
 * prefilled (see `workout/startProgramSession.ts`); finishing that session moves the run on to the
 * session after it, week by week; finishing the last session ends the run. The lifter can also
 * stop a run at any time. Everything works offline: a run is an ordinary synced row, saved on the
 * phone first and uploaded later.
 *
 * Where a run "is" is stored as two POSITIONS — the `position` of the next session's week, and of
 * that workout within its week — not as a program workout's id. Why: programs are edited while
 * they run. Weeks and workouts are never renumbered (B34 only ever appends them), so a stored
 * position keeps meaning the same session; and when the lifter deletes that session (or its week),
 * the positions simply slide to whatever session now stands there (`resolveNextSession`). An id
 * would dangle with nothing to fall back on.
 *
 * At most one run is active at a time — enforced here, not by the server (a server rule could be
 * broken by two phones starting runs offline, and the refused upload would block that phone's
 * queue forever). So:
 *   - starting a run ends every active run this phone can see, in the same save;
 *   - every read treats the NEWEST active run (latest `started_at`, then highest id) as "the" run.
 * Two phones offline can briefly hold two active rows; both phones agree on the newest, and the
 * next start or stop on either ends them all.
 *
 * Runs are never deleted; they end (`ended_at`). Every place that stamps `ended_at` uses
 * `endTime`, which never returns a time before the run's start: the server refuses
 * `ended_at < started_at`, and a run started on a phone whose clock was ahead could otherwise be
 * stopped "before it started" on another phone and be refused at upload forever.
 *
 * This module never imports the workout logger: the logger's finish imports this one (to advance
 * the run in the same transaction), so the other direction would be an import cycle.
 */
import { assertValidProgramPosition } from '@training-math';

import { fromSqlRow, TABLE_COLUMNS, writeLocal, type ProgramRunRow } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { newUuid } from '@/lib/ids';

import { readProgramTree, type ProgramTree, type ProgramWeekNode, type ProgramWorkoutNode } from './programs';

/** Why a run operation was refused — so a screen can say something sensible. */
export type ProgramRunRefusal =
  /** The program is unknown on this phone, someone else's, or deleted. */
  | 'program-missing'
  /** The program has no live workout to start, so it can't be run. */
  | 'program-empty'
  /** There is no active run. */
  | 'no-run'
  /** The active run has no next session left (the author deleted the rest of the program). */
  | 'run-complete';

/** A refused run operation; `reason` says which refusal it is. */
export class ProgramRunError extends Error {
  constructor(
    readonly reason: ProgramRunRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'ProgramRunError';
  }
}

/** One session of a program: a live workout and the live week it sits in. */
export interface ProgramSession {
  week: ProgramWeekNode;
  workout: ProgramWorkoutNode;
}

/** A place in a program, as stored positions (not the 1-based "Week N" display numbers). */
export interface ProgramPositions {
  weekPosition: number;
  workoutPosition: number;
}

/** The lifter's active run as the Workout tab shows it. */
export interface ActiveProgramRun {
  run: ProgramRunRow;
  /** The program's whole live tree, as it stands now. */
  tree: ProgramTree;
  /** The session the next tap of Workout starts, or null if the program has none left. */
  nextSession: ProgramSession | null;
}

/** Options every writer takes: an injectable clock and id maker, so tests are repeatable. */
export interface ProgramRunWriteOptions {
  /** The current time as ISO-8601 text. */
  now?: string;
  /** Makes the id of a newly started run. */
  newId?: () => string;
}

/**
 * Finds the session a run's stored positions point at, in the program as it stands now.
 *
 * The rule, walking the live weeks in order:
 *   1. weeks before the stored week position are already done — skipped;
 *   2. a week AT the stored position: its first live workout at or after the stored workout
 *      position; if it has none (the rest of that week was deleted), move on;
 *   3. a week AFTER the stored position: its first live workout (a stored workout position only
 *      means something inside its own week — so if the run's week was deleted, the run starts the
 *      next week from the top);
 *   4. weeks with no live workouts are skipped; if nothing is left, returns null (the program has
 *      no next session).
 *
 * Pure: takes the tree and the positions, reads nothing. Weeks (or workouts) that share a position
 * — two offline phones each appended one — can't be told apart by position; the first in tree
 * order wins.
 */
export function resolveNextSession(tree: ProgramTree, at: ProgramPositions): ProgramSession | null {
  return findSession(tree, at, 'at-or-after');
}

/**
 * The session strictly AFTER the one at `finished` — what a run moves on to when the lifter
 * finishes that session. Same walk as `resolveNextSession`, except that inside the finished
 * session's own week only workouts with a higher position count. `finished` can be a session
 * the author has since deleted: its positions still say where it stood.
 *
 * Advancing from the session actually finished, not from the run's stored pointer, keeps the run
 * honest: finishing Week 1 · Workout 1 twice points at Workout 2 both times.
 */
export function sessionAfter(tree: ProgramTree, finished: ProgramPositions): ProgramSession | null {
  return findSession(tree, finished, 'after');
}

/** The shared walk behind `resolveNextSession` and `sessionAfter`. */
function findSession(tree: ProgramTree, at: ProgramPositions, mode: 'at-or-after' | 'after'): ProgramSession | null {
  for (const week of tree.weeks) {
    const position = week.week.position;
    if (position < at.weekPosition) continue;
    const workout =
      position === at.weekPosition
        ? week.workouts.find((w) =>
            mode === 'after' ? w.workout.position > at.workoutPosition : w.workout.position >= at.workoutPosition,
          )
        : week.workouts[0];
    if (workout) return { week, workout };
  }
  return null;
}

/** "Week 2 · Day A" — how a session is named on the Workout tab and in its workout title. */
export function programSessionLabel(session: ProgramSession): string {
  return `Week ${session.week.number} · ${session.workout.label}`;
}

/**
 * The run's end time: `now`, or the run's start if `now` is earlier (a phone whose clock is
 * behind the one that started the run). The server refuses an end before the start, and such an
 * upload would block the queue forever, so no `ended_at` is ever written without this.
 */
function endTime(now: string, startedAt: string): string {
  return Date.parse(now) < Date.parse(startedAt) ? startedAt : now;
}

/** Every active run of the lifter, each stamped ended at `now` (clamped) — ready to save. */
async function endedActiveRuns(db: SqlExecutor, userId: string, now: string): Promise<ProgramRunRow[]> {
  return (await activeRuns(db, userId)).map((run) => ({ ...run, ended_at: endTime(now, run.started_at) }));
}

/** Every active run of the lifter on this phone, newest first (latest start, then highest id). */
async function activeRuns(db: SqlExecutor, userId: string): Promise<ProgramRunRow[]> {
  const columns = (TABLE_COLUMNS.program_runs as readonly string[]).join(', ');
  const raw = await db.getAllAsync<Record<string, unknown>>(
    `select ${columns} from program_runs where user_id = ? and ended_at is null order by started_at desc, id desc`,
    [userId],
  );
  return raw.map((r) => fromSqlRow('program_runs', r));
}

/** The run row with its pointer moved to `session`, positions checked against the server's rule. */
function pointedAt(run: ProgramRunRow, session: ProgramSession): ProgramRunRow {
  const next = { weekPosition: session.week.week.position, workoutPosition: session.workout.workout.position };
  assertValidProgramPosition(next.weekPosition);
  assertValidProgramPosition(next.workoutPosition);
  return { ...run, next_week_position: next.weekPosition, next_workout_position: next.workoutPosition };
}

/**
 * Starts running one of the lifter's programs from its first session, and returns the new run.
 * Any run that was active is ended in the same save (so switching programs is just starting
 * another one). Refuses with a `ProgramRunError` when the program is missing or deleted
 * (`program-missing`) or has no live workout to start (`program-empty`). Restarting a program
 * that was run before always begins again at its first session.
 */
export async function startProgramRun(
  db: SqlDriver,
  userId: string,
  programId: string,
  options: ProgramRunWriteOptions = {},
): Promise<ProgramRunRow> {
  const tree = await readProgramTree(db, userId, programId);
  if (!tree) throw new ProgramRunError('program-missing', `Program ${programId} is not a live program of this lifter`);
  const first = resolveNextSession(tree, { weekPosition: 0, workoutPosition: 0 });
  if (!first) throw new ProgramRunError('program-empty', 'This program has no workouts yet');

  const now = options.now ?? new Date().toISOString();
  const ended = await endedActiveRuns(db, userId, now);
  const run = pointedAt(
    {
      id: (options.newId ?? newUuid)(),
      user_id: userId,
      program_id: programId,
      next_week_position: 0,
      next_workout_position: 0,
      started_at: now,
      ended_at: null,
      created_at: now,
      updated_at: now,
    },
    first,
  );
  // One save: the old runs end and the new one starts together, or neither does.
  await writeLocal(db, 'program_runs', [...ended, run], { now });
  return { ...run, updated_at: now };
}

/**
 * Stops the lifter's active run (the Workout tab's "Stop program"). Ends every active run this
 * phone holds — normally exactly one; a straggler left by two offline phones is closed too, so
 * stopping never makes an older run reappear. Does nothing when no run is active.
 */
export async function stopProgramRun(db: SqlDriver, userId: string, options: ProgramRunWriteOptions = {}): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  const ended = await endedActiveRuns(db, userId, now);
  if (ended.length === 0) return;
  await writeLocal(db, 'program_runs', ended, { now });
}

/**
 * The lifter's active run with its live program and the session the next tap of Workout starts —
 * or null when no run is active, or when the newest active run's program is gone (deleted, or not
 * on this phone yet): there is then nothing to offer. `nextSession` is null when the program has
 * no session left at or after the run's place (the author deleted the rest mid-run); the tab then
 * says so and offers Stop instead of a dead button.
 */
export async function readActiveRun(db: SqlExecutor, userId: string): Promise<ActiveProgramRun | null> {
  const [run] = await activeRuns(db, userId);
  if (!run) return null;
  const tree = await readProgramTree(db, userId, run.program_id);
  if (!tree) return null;
  const nextSession = resolveNextSession(tree, {
    weekPosition: run.next_week_position,
    workoutPosition: run.next_workout_position,
  });
  return { run, tree, nextSession };
}

/**
 * The run rows to save when the lifter finishes a workout started from program workout
 * `programWorkoutId` — called by the logger's finish, which saves them in the SAME transaction as
 * the workout (so a killed app can never log the session without moving the run).
 *
 * `sessionStartedAt` is when the finished workout was started.
 *
 * Returns:
 *   - `[]` (move nothing) when there is no active run, the run's program is gone, the finished
 *     session isn't part of the run's program (a session started from a program the lifter has
 *     since switched away from), or the session was started BEFORE the run — it belongs to an
 *     earlier run (the lifter stopped and restarted the program meanwhile), and finishing it must
 *     not push the fresh run past Week 1;
 *   - the run pointing at the session after the finished one;
 *   - the run ended at `now` (never before its start) when the finished session was the last one.
 *
 * The finished session's place is read from its own rows even if the author has deleted it since:
 * soft deletes keep the rows, and their positions still say where it stood.
 */
export async function advanceRunOnFinish(
  db: SqlExecutor,
  userId: string,
  programWorkoutId: string,
  sessionStartedAt: string,
  now: string,
): Promise<ProgramRunRow[]> {
  const [run] = await activeRuns(db, userId);
  if (!run) return [];
  if (Date.parse(sessionStartedAt) < Date.parse(run.started_at)) return [];
  const finished = await db.getFirstAsync<{ week_position: number; workout_position: number; program_id: string }>(
    `select w.position as week_position, pw.position as workout_position, w.program_id as program_id
     from program_workouts pw join program_weeks w on w.id = pw.program_week_id
     where pw.id = ?`,
    [programWorkoutId],
  );
  if (!finished || finished.program_id !== run.program_id) return [];
  const tree = await readProgramTree(db, userId, run.program_id);
  if (!tree) return [];
  const next = sessionAfter(tree, { weekPosition: finished.week_position, workoutPosition: finished.workout_position });
  return [next ? pointedAt(run, next) : { ...run, ended_at: endTime(now, run.started_at) }];
}
