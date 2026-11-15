/**
 * "Start next session" (PRG-3, LOG-1, B35): starts the next session of the lifter's active program
 * run as a new workout, prefilled from the program, and puts it in the shared session slot so the
 * logger opens on it.
 *
 * What "prefilled" means:
 *   - the workout's title names the session: "<program> — Week 2 · Day A";
 *   - every exercise of the session is already added, in the program's order;
 *   - each exercise carries its targets as its note: "Target: 3 × 8 @ 225 lb · RPE 8", with the
 *     weight in the lifter's unit. The note shows in the logger, survives the app being killed
 *     (it is a saved draft row like everything else), and the lifter can edit or clear it.
 *
 * Deliberately NO sets are created from the targets. Sets in Astra are work actually done —
 * the analysis, PR detection and the feed all read them that way — so a Finish without touching
 * them would invent volume (and maybe PRs) the lifter never lifted.
 *
 * Everything goes through the ordinary logger store operations (start, set the title, add an
 * exercise, write its note): no second write path. It is a short series of saves, not one: if the
 * app dies part-way, Resume shows a partly prefilled workout, which the lifter can finish or
 * discard. Nothing is uploaded early either way (drafts never sync).
 *
 * Kept out of `programs/programRuns.ts` on purpose: this file needs the logger, and the logger's
 * finish needs `programRuns.ts` — putting this there would make an import cycle.
 */
import { MAX_WORKOUT_TITLE_LENGTH, type WeightUnit } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import { programSessionLabel, ProgramRunError, readActiveRun } from '@/programs/programRuns';
import { formatProgramTargets } from '@/programs/programs';

import { canLogExercise, type ActiveWorkoutOptions, type ActiveWorkoutStore } from './activeWorkout';
import { startSessionWorkout } from './activeWorkoutSession';

/**
 * The prefilled workout title — "<program> — Week N · <workout>" — cut to the server's
 * 100-character title limit (counted the way the server counts: one per character, so an emoji
 * is one), ending with "…" when cut.
 */
export function programSessionTitle(programName: string, sessionLabel: string): string {
  const full = Array.from(`${programName} — ${sessionLabel}`);
  if (full.length <= MAX_WORKOUT_TITLE_LENGTH) return full.join('');
  return `${full.slice(0, MAX_WORKOUT_TITLE_LENGTH - 1).join('').trimEnd()}…`;
}

/** The note an exercise of a program session starts with: "Target: 3 × 8 @ 225 lb · RPE 8". */
export function programTargetNote(slot: Parameters<typeof formatProgramTargets>[0], unit: WeightUnit): string {
  return `Target: ${formatProgramTargets(slot, unit)}`;
}

/**
 * Starts the active run's next session for `userId`, prefilled (see the file comment), and
 * returns its store — the caller opens the logger. `unit` is the lifter's display unit, for the
 * target weights in the notes.
 *
 * Refuses with a `ProgramRunError` when no run is active (`no-run`) or the run has no next
 * session (`run-complete`); the Workout tab doesn't offer the button then, so this is a safety
 * net. Throws, like a plain start, when a workout is already in progress.
 *
 * A slot whose exercise this phone can't log (removed for good, or not visible) is skipped
 * rather than failing the whole start; the session's other exercises are still added.
 */
export async function startProgramSession(
  db: SqlDriver,
  userId: string,
  unit: WeightUnit,
  options: Omit<ActiveWorkoutOptions, 'programWorkoutId'> = {},
): Promise<ActiveWorkoutStore> {
  const active = await readActiveRun(db, userId);
  if (!active) throw new ProgramRunError('no-run', 'No program is being run');
  const session = active.nextSession;
  if (!session) throw new ProgramRunError('run-complete', 'This program has no next session');

  const store = await startSessionWorkout(db, userId, { ...options, programWorkoutId: session.workout.workout.id });
  await store.setTitle(programSessionTitle(active.tree.program.name, programSessionLabel(session)));
  for (const { slot } of session.workout.exercises) {
    // Checked first (the logger's own rule), so a missing exercise is skipped, not thrown.
    if (!slot.exercise_id || !(await canLogExercise(db, userId, slot.exercise_id))) continue;
    const entry = await store.addExercise(slot.exercise_id);
    await store.setEntryNotes(entry.id, programTargetNote(slot, unit));
  }
  return store;
}
