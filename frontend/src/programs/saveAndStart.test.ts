/**
 * Tests for Save and Start (B40 — MKT-5), on real SQLite: one call saves a published program as
 * the lifter's own (queued for upload) and makes it the active program; an empty program is saved
 * but not started (`started: false`, no run); starting replaces a run already going; and — the
 * step's definition of done — a published payload through Save and Start, then the Workout tab's
 * "Start next session" opens Week 1 Day 1 prefilled with its targets.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import type { TeamProgramPayload } from '@/social/teamCoaching';
import { pendingRows } from '@/sync/outbox';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { clearSessionWorkout } from '@/workout/activeWorkoutSession';
import { startProgramSession } from '@/workout/startProgramSession';

import { readActiveRun, startProgramRun } from './programRuns';
import { createProgram, addWeek, addProgramWorkout, listPrograms } from './programs';
import { saveAndStartProgram, saveProgramOnly } from './saveAndStart';

const LIFTER = 'a0000000-0000-4000-8000-000000000001';
const T0 = '2026-11-16T10:00:00.000Z';
const SQUAT = libraryExerciseId('squat');
const BENCH = libraryExerciseId('bench_press');

let db: SqlDriver;
let ids = 0;
const newId = () => `b0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

beforeEach(async () => {
  ids = 0;
  db = await prepareDatabase(createNodeSqliteDriver());
});

afterEach(() => clearSessionWorkout());

/** A published program as `program_payload` sends it: 2 weeks, Day A (squat, bench) and Day B. */
const published: TeamProgramPayload = {
  name: 'Barbell Basics',
  weeks: [0, 1].map((w) => ({
    position: w,
    workouts: [
      {
        name: 'Day A',
        position: 0,
        exercises: [
          { exerciseId: SQUAT, exerciseName: 'Squat', position: 0, targetSets: 3, targetReps: 5, targetWeightKg: 100, targetRpe: 8 },
          { exerciseId: BENCH, exerciseName: 'Bench Press', position: 1, targetSets: 3, targetReps: 8, targetWeightKg: null, targetRpe: null },
        ],
      },
      { name: 'Day B', position: 1, exercises: [] },
    ],
  })),
};

describe('saveAndStartProgram', () => {
  it('saves the program as the lifter’s own, queued for upload, and makes it the active program', async () => {
    const result = await saveAndStartProgram(db, LIFTER, published, { now: T0, newId });
    expect(result).toMatchObject({ skippedExercises: 0, started: true });

    const programs = await listPrograms(db, LIFTER);
    expect(programs.map((p) => [p.program.id, p.program.name, p.program.visibility])).toEqual([
      [result.programId, 'Barbell Basics', 'private'],
    ]);
    expect(await pendingRows(db, 'programs')).toHaveLength(1);
    expect(await pendingRows(db, 'program_runs')).toHaveLength(1);

    const active = await readActiveRun(db, LIFTER);
    expect(active?.run.program_id).toBe(result.programId);
    expect(active?.nextSession?.week.number).toBe(1);
    expect(active?.nextSession?.workout.label).toBe('Day A');
  });

  it('an empty program is saved but not started — no run, and no throw', async () => {
    const result = await saveAndStartProgram(db, LIFTER, { name: 'Empty Shelf', weeks: [] }, { now: T0, newId });
    expect(result.started).toBe(false);
    expect((await listPrograms(db, LIFTER)).map((p) => p.program.name)).toEqual(['Empty Shelf']);
    expect(await readActiveRun(db, LIFTER)).toBeNull();
  });

  it('a copy that can’t be made throws and saves nothing', async () => {
    await expect(saveAndStartProgram(db, LIFTER, { name: '   ', weeks: [] }, { now: T0, newId })).rejects.toThrow();
    expect(await listPrograms(db, LIFTER)).toEqual([]);
  });

  it('replaces the run already going (B35: one active program)', async () => {
    const own = await createProgram(db, LIFTER, 'My Own', { now: T0, newId });
    const week = await addWeek(db, LIFTER, own.id, { now: T0, newId });
    await addProgramWorkout(db, LIFTER, week.id, 'Mine A', { now: T0, newId });
    await startProgramRun(db, LIFTER, own.id, { now: T0, newId });

    const result = await saveAndStartProgram(db, LIFTER, published, { now: '2026-11-16T11:00:00.000Z', newId });
    expect((await readActiveRun(db, LIFTER))?.run.program_id).toBe(result.programId);
    const runs = await db.getAllAsync<{ program_id: string; ended_at: string | null }>('select program_id, ended_at from program_runs');
    expect(runs.filter((r) => r.ended_at == null).map((r) => r.program_id)).toEqual([result.programId]);
  });

  it('saveProgramOnly copies the program and starts nothing', async () => {
    const result = await saveProgramOnly(db, LIFTER, published, { now: T0, newId });
    expect(result).toMatchObject({ skippedExercises: 0, started: false });
    expect((await listPrograms(db, LIFTER)).map((p) => p.program.id)).toEqual([result.programId]);
    expect(await readActiveRun(db, LIFTER)).toBeNull();
  });

  it('step DoD: Save and Start, then Start next session opens Week 1 · Day A prefilled', async () => {
    await saveAndStartProgram(db, LIFTER, published, { now: T0, newId });
    let ms = Date.parse('2026-11-16T12:00:00.000Z');
    const store = await startProgramSession(db, LIFTER, 'kg', {
      clock: () => new Date((ms += 60_000)).toISOString(),
      mintId: newId,
    });
    const snap = store.getSnapshot();
    expect(snap.workout.title).toBe('Barbell Basics — Week 1 · Day A');
    expect(snap.entries.map((e) => e.exercise_id)).toEqual([SQUAT, BENCH]);
    expect(snap.entries.map((e) => e.notes)).toEqual(['Target: 3 × 5 @ 100 kg · RPE 8', 'Target: 3 × 8']);
  });
});
