/**
 * "Start this workout" on a workout a coach pushed to the team (B37 — TEAM-3).
 *
 * The small sibling of `startProgramSession.ts`: starts a new workout prefilled from ONE pushed
 * program workout — its title is the workout's name ("<program> — Day A"), each exercise is
 * already added in order, and each carries its targets as its note ("Target: 3 × 5 @ 100 kg"),
 * weight in the lifter's unit. No sets are created (sets are work actually done — the same rule
 * as a program session).
 *
 * Unlike a program session it is NOT linked to any program: it is not in a run, so finishing it
 * moves no run forward. The pushed workout lives in the coach's account; nothing of it is copied
 * except what lands in this one workout.
 *
 * A slot whose exercise this phone can't log (the coach's own custom exercise, or one removed for
 * good) is skipped — the logger's own rule, `canLogExercise` — and the rest still start.
 * Throws, like any start, while another workout is unfinished.
 */
import type { WeightUnit } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import type { TeamWorkoutPayload } from '@/social/teamCoaching';

import { canLogExercise, type ActiveWorkoutOptions, type ActiveWorkoutStore } from './activeWorkout';
import { startSessionWorkout } from './activeWorkoutSession';
import { programSessionTitle, programTargetNote } from './startProgramSession';

/** What the start made: the logger's store, and how many exercises couldn't be added. */
export interface PushedWorkoutStart {
  store: ActiveWorkoutStore;
  skippedExercises: number;
}

/**
 * Starts `payload` as a new workout for `userId` and puts it in the shared session slot, so the
 * logger opens on it (see the file comment).
 */
export async function startPushedWorkout(
  db: SqlDriver,
  userId: string,
  payload: TeamWorkoutPayload,
  unit: WeightUnit,
  options: Omit<ActiveWorkoutOptions, 'programWorkoutId'> = {},
): Promise<PushedWorkoutStart> {
  const store = await startSessionWorkout(db, userId, options);
  await store.setTitle(programSessionTitle(payload.programName, payload.name ?? 'Workout'));
  let skippedExercises = 0;
  for (const slot of payload.exercises) {
    if (!slot.exerciseId || !(await canLogExercise(db, userId, slot.exerciseId))) {
      skippedExercises += 1;
      continue;
    }
    const entry = await store.addExercise(slot.exerciseId);
    await store.setEntryNotes(
      entry.id,
      programTargetNote(
        {
          target_sets: slot.targetSets,
          target_reps: slot.targetReps,
          target_weight_kg: slot.targetWeightKg,
          target_rpe: slot.targetRpe,
        },
        unit,
      ),
    );
  }
  return { store, skippedExercises };
}
