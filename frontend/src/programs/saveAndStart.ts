/**
 * Save and Start (B40 — MKT-5) — the ONE home for "copy this program into my programs and start
 * running it". Two screens call it: the Marketplace program page's **Save and Start**, and a team
 * member's **Start program** on a coach's assignment (B37). Before B40 that sequence lived inside
 * the team page; it moved here so the two screens can never drift apart.
 *
 * What it does, in order:
 *   1. `createProgramFromPayload` writes the program the server handed over as a brand-new
 *      program owned by the lifter (fresh ids, one transaction, starts private). If this fails
 *      it THROWS and nothing was saved — the screen says "couldn't be saved".
 *   2. `startProgramRun` makes that copy the lifter's active program (ending any other active
 *      run — the B35 rule, so the screens warn "This will replace your current program"). If
 *      this fails — the copy has no workout to run, or anything else — the copy still exists, so
 *      this does NOT throw: it answers `started: false` and the screen says "saved, but couldn't
 *      be started".
 *
 * Everything happens on the phone (no signal needed once the payload is in hand); the new rows
 * upload like any program the lifter built. Saving without starting is `saveProgramOnly`, the
 * same copy with the same answer shape, so both screens' "Save" buttons read alike.
 *
 * This module composes the copy and the run modules only; it must never import the workout
 * logger (the logger imports `programRuns`, so that direction would be an import cycle).
 */
import type { SqlDriver } from '@/db/driver';
import type { TeamProgramPayload } from '@/social/teamCoaching';

import { createProgramFromPayload } from './copyProgram';
import { startProgramRun } from './programRuns';
import type { ProgramWriteOptions } from './programs';

/** What Save and Start did: the new program's id, how many slots lost an exercise, and whether the run started. */
export interface SaveAndStartResult {
  programId: string;
  skippedExercises: number;
  /** True when the copy is now the active program; false when it was saved but couldn't be started. */
  started: boolean;
}

/**
 * Copies `payload` into `userId`'s programs, then starts running the copy. Throws only when the
 * copy itself fails (nothing saved). `options` (clock and id maker, for tests) apply to both writes.
 */
export async function saveAndStartProgram(
  db: SqlDriver,
  userId: string,
  payload: TeamProgramPayload,
  options: ProgramWriteOptions = {},
): Promise<SaveAndStartResult> {
  const copy = await createProgramFromPayload(db, userId, payload, options);
  try {
    await startProgramRun(db, userId, copy.programId, options);
  } catch (caught) {
    console.warn('Save and Start: the copy was saved but its run could not start', caught);
    return { ...copy, started: false };
  }
  return { ...copy, started: true };
}

/**
 * The other button beside Save and Start: copies `payload` into `userId`'s programs and starts
 * nothing. Same answer shape (`started` is always false), so a screen offering both buttons
 * handles them the same way. Throws when the copy fails (nothing saved).
 */
export async function saveProgramOnly(
  db: SqlDriver,
  userId: string,
  payload: TeamProgramPayload,
  options: ProgramWriteOptions = {},
): Promise<SaveAndStartResult> {
  return { ...(await createProgramFromPayload(db, userId, payload, options)), started: false };
}
