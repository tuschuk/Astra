/**
 * Copying a coach's program into a member's own programs (B37 — TEAM-3).
 *
 * Why a copy: a coach's program lives in the coach's account and never syncs to a member's phone
 * (program tables are author-only — see `programs/programs.ts`). For an assigned program to become
 * the member's active run, the program must be on the member's phone and theirs: a run, its
 * "Start next session" prefill and its advance on Finish all read the phone's own programs. So the
 * member's tap of Start copies the program the server handed over (`social/teamCoaching.ts`'s
 * payload) into a brand-new program owned by the member, then starts running it.
 *
 * The copy is the member's from then on: the coach editing their program later does not change a
 * run in progress (the same rule as "a started session never changes"); the coach re-assigns if
 * they want the member on the new version.
 *
 * One limitation, stated to the member: a slot naming an exercise this phone can't log — the
 * coach's own custom exercise — is copied with no exercise (it shows as "Deleted exercise"), so
 * the program keeps its shape. `skippedExercises` reports how many, for the confirmation line.
 *
 * Everything is written in ONE transaction through the ordinary local write path, so a killed app
 * leaves either the whole program or nothing, and the rows upload like any program the member
 * built themselves. No new sync code.
 */
import {
  assertValidProgramName,
  assertValidProgramPosition,
  assertValidProgramTargets,
  assertValidProgramWorkoutName,
  roundRpeForStorage,
  roundWeightKgForStorage,
} from '@training-math';

import {
  notifyLocalWrite,
  writeLocalRowsTx,
  type ProgramExerciseRow,
  type ProgramRow,
  type ProgramWeekRow,
  type ProgramWorkoutRow,
} from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { newUuid } from '@/lib/ids';
import type { PayloadWorkout, TeamProgramPayload } from '@/social/teamCoaching';
import { canLogExercise } from '@/workout/activeWorkout';

import type { ProgramWriteOptions } from './programs';

/** What a copy made: the new program's id, and how many slots lost an exercise this phone can't use. */
export interface ProgramCopy {
  programId: string;
  skippedExercises: number;
}

/**
 * Writes `payload` as a new program owned by `userId` — weeks, workouts and exercise slots in the
 * payload's order, numbered 0, 1, 2… at each level — and returns its id. Every row gets a fresh
 * id. Throws (saving nothing) if a name or target breaks the server's rules — which the payload,
 * coming from the server's own rows, should never do.
 */
export async function createProgramFromPayload(
  db: SqlDriver,
  userId: string,
  payload: TeamProgramPayload,
  options: ProgramWriteOptions = {},
): Promise<ProgramCopy> {
  const now = options.now ?? new Date().toISOString();
  const newId = options.newId ?? newUuid;
  const name = payload.name.trim();
  assertValidProgramName(name);

  // A copy is the lifter's own new program, so it starts private whatever the original's setting (B39).
  const program: ProgramRow = {
    id: newId(),
    user_id: userId,
    name,
    visibility: 'private',
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  const weeks: ProgramWeekRow[] = [];
  const workouts: ProgramWorkoutRow[] = [];
  const slots: ProgramExerciseRow[] = [];
  let skippedExercises = 0;

  // Which exercise ids this lifter can log, asked once per id.
  const usable = new Map<string, boolean>();
  async function canUse(exerciseId: string): Promise<boolean> {
    const known = usable.get(exerciseId);
    if (known !== undefined) return known;
    const answer = await canLogExercise(db, userId, exerciseId);
    usable.set(exerciseId, answer);
    return answer;
  }

  /** Adds one workout's row and its slots to the batch. */
  async function copyWorkout(source: PayloadWorkout, weekId: string, position: number): Promise<void> {
    assertValidProgramPosition(position);
    const workoutName = source.name?.trim() ? source.name.trim() : null;
    assertValidProgramWorkoutName(workoutName);
    const workout: ProgramWorkoutRow = {
      id: newId(),
      program_week_id: weekId,
      name: workoutName,
      position,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    workouts.push(workout);
    for (const [slotIndex, slot] of source.exercises.entries()) {
      let exerciseId = slot.exerciseId;
      if (exerciseId && !(await canUse(exerciseId))) {
        exerciseId = null;
        skippedExercises += 1;
      }
      const targetWeightKg = slot.targetWeightKg == null ? null : roundWeightKgForStorage(slot.targetWeightKg);
      const targetRpe = slot.targetRpe == null ? null : roundRpeForStorage(slot.targetRpe);
      assertValidProgramTargets({
        position: slotIndex,
        targetSets: slot.targetSets,
        targetReps: slot.targetReps,
        targetWeightKg,
        targetRpe,
      });
      slots.push({
        id: newId(),
        program_workout_id: workout.id,
        exercise_id: exerciseId,
        position: slotIndex,
        target_sets: slot.targetSets,
        target_reps: slot.targetReps,
        target_weight_kg: targetWeightKg,
        target_rpe: targetRpe,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  for (const [weekIndex, sourceWeek] of payload.weeks.entries()) {
    assertValidProgramPosition(weekIndex);
    const week: ProgramWeekRow = {
      id: newId(),
      program_id: program.id,
      position: weekIndex,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    weeks.push(week);
    for (const [workoutIndex, sourceWorkout] of sourceWeek.workouts.entries()) {
      await copyWorkout(sourceWorkout, week.id, workoutIndex);
    }
  }

  // Parents first, so the upload queue sends them in an order the server accepts.
  await db.withTransactionAsync(async (tx) => {
    await writeLocalRowsTx(tx, 'programs', [program], now);
    await writeLocalRowsTx(tx, 'program_weeks', weeks, now);
    await writeLocalRowsTx(tx, 'program_workouts', workouts, now);
    await writeLocalRowsTx(tx, 'program_exercises', slots, now);
  });
  notifyLocalWrite(db, ['programs', 'program_weeks', 'program_workouts', 'program_exercises']);
  return { programId: program.id, skippedExercises };
}

/**
 * The confirmation line about slots that didn't copy, or null when every exercise came across.
 * `owner` names whose custom exercises they were: "coach" on a team (B37), "author" for a
 * Marketplace program (B40) — same rule, the right word for where the lifter got it.
 */
export function skippedExercisesLine(skipped: number, owner: 'coach' | 'author' = 'coach'): string | null {
  if (skipped === 0) return null;
  return skipped === 1
    ? `1 exercise is the ${owner}’s own and didn’t copy.`
    : `${skipped} exercises are the ${owner}’s own and didn’t copy.`;
}
