/**
 * Tests for the program-run module (PRG-3, B35): starting, stopping and reading a run; the
 * position rule that finds the next session (and slides sensibly when the author edits the
 * program mid-run); advancing on finish (the rows the logger's finish saves); the clock clamp on
 * every end time; newest-wins when two active runs exist; and a run surviving the trip through
 * sync to a second phone. Real SQLite (node driver); the fake server stands in for Supabase.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { writeLocal, type ProgramRunRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import { pendingRows } from '@/sync/outbox';
import { pullChanges } from '@/sync/pull';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import {
  addProgramExercise,
  addProgramWorkout,
  addWeek,
  createProgram,
  deleteProgram,
  readProgramTree,
  removeProgramWorkout,
  removeWeek,
  type ProgramTree,
} from './programs';
import {
  advanceRunOnFinish,
  programSessionLabel,
  ProgramRunError,
  readActiveRun,
  resolveNextSession,
  sessionAfter,
  startProgramRun,
  stopProgramRun,
} from './programRuns';

const USER = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const T0 = '2026-11-15T10:00:00.000Z';
const T1 = '2026-11-15T11:00:00.000Z';
const BENCH = libraryExerciseId('bench_press');

let db: SqlDriver;
let ids = 0;
/** Predictable ids for new rows. */
const newId = () => `b0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const opts = { now: T0, newId };

beforeEach(async () => {
  ids = 0;
  db = await prepareDatabase(createNodeSqliteDriver());
});

/** A program with `shape[i]` workouts in week i (named "W<i+1>D<j+1>"); returns its ids. */
async function program(shape: number[], name = 'Strength Block') {
  const p = await createProgram(db, USER, name, opts);
  const weeks: { id: string; workouts: string[] }[] = [];
  for (let w = 0; w < shape.length; w++) {
    const week = await addWeek(db, USER, p.id, opts);
    const workouts: string[] = [];
    for (let d = 0; d < shape[w]; d++) {
      const pw = await addProgramWorkout(db, USER, week.id, `W${w + 1}D${d + 1}`, opts);
      await addProgramExercise(db, USER, pw.id, { exerciseId: BENCH, targets: { sets: 3, reps: 5, weight: null, rpe: null } }, opts);
      workouts.push(pw.id);
    }
    weeks.push({ id: week.id, workouts });
  }
  return { programId: p.id, weeks };
}

async function tree(programId: string): Promise<ProgramTree> {
  const t = await readProgramTree(db, USER, programId);
  if (!t) throw new Error('no tree');
  return t;
}

/** The next session's workout name, or null. */
async function nextName(): Promise<string | null> {
  const active = await readActiveRun(db, USER);
  return active?.nextSession?.workout.label ?? null;
}

/**
 * `advanceRunOnFinish` for the test lifter, for a session of `programWorkoutId` started at
 * `sessionStartedAt` (default T1 — after every run these tests start) and finished at `now`.
 */
function advance(programWorkoutId: string, now: string, sessionStartedAt = T1): Promise<ProgramRunRow[]> {
  return advanceRunOnFinish(db, USER, programWorkoutId, sessionStartedAt, now);
}

/** Every program_runs row on the phone, oldest id first. */
async function allRuns(): Promise<ProgramRunRow[]> {
  return db.getAllAsync<ProgramRunRow>('select * from program_runs order by id');
}

describe('resolveNextSession / sessionAfter (the position rule)', () => {
  it('finds the session at the stored positions, and the one strictly after a finished one', async () => {
    const { programId } = await program([2, 2]);
    const t = await tree(programId);
    expect(resolveNextSession(t, { weekPosition: 0, workoutPosition: 0 })?.workout.label).toBe('W1D1');
    expect(resolveNextSession(t, { weekPosition: 0, workoutPosition: 1 })?.workout.label).toBe('W1D2');
    expect(sessionAfter(t, { weekPosition: 0, workoutPosition: 0 })?.workout.label).toBe('W1D2');
    // The end of a week rolls into the next week's first workout.
    expect(sessionAfter(t, { weekPosition: 0, workoutPosition: 1 })?.workout.label).toBe('W2D1');
    expect(sessionAfter(t, { weekPosition: 1, workoutPosition: 1 })).toBeNull();
  });

  it('skips weeks with no live workouts, and starts a later week from the top', async () => {
    const { programId } = await program([0, 1, 0, 2]);
    const t = await tree(programId);
    expect(resolveNextSession(t, { weekPosition: 0, workoutPosition: 0 })?.workout.label).toBe('W2D1');
    // A workout position from another week means nothing in a later week: its first workout wins.
    expect(resolveNextSession(t, { weekPosition: 2, workoutPosition: 5 })?.workout.label).toBe('W4D1');
    expect(sessionAfter(t, { weekPosition: 1, workoutPosition: 0 })?.workout.label).toBe('W4D1');
  });

  it('labels a session "Week N · <workout>" by display number', async () => {
    const { programId } = await program([1, 1]);
    const t = await tree(programId);
    const s = resolveNextSession(t, { weekPosition: 1, workoutPosition: 0 });
    expect(s && programSessionLabel(s)).toBe('Week 2 · W2D1');
  });
});

describe('startProgramRun', () => {
  it("points a new run at the program's first live session", async () => {
    const { programId } = await program([0, 2]);
    const run = await startProgramRun(db, USER, programId, opts);
    expect(run).toMatchObject({ user_id: USER, program_id: programId, next_week_position: 1, next_workout_position: 0, ended_at: null });
    expect(await nextName()).toBe('W2D1');
    // Saved and queued for upload in one step.
    expect((await pendingRows(db, 'program_runs')).map((p) => p.rowId)).toEqual([run.id]);
  });

  it('refuses a program that is missing, deleted, someone else’s, or has no workouts', async () => {
    const empty = await createProgram(db, USER, 'Empty', opts);
    await addWeek(db, USER, empty.id, opts);
    await expect(startProgramRun(db, USER, empty.id, opts)).rejects.toMatchObject({ reason: 'program-empty' });
    await expect(startProgramRun(db, OTHER, empty.id, opts)).rejects.toMatchObject({ reason: 'program-missing' });
    await deleteProgram(db, USER, empty.id, opts);
    await expect(startProgramRun(db, USER, empty.id, opts)).rejects.toBeInstanceOf(ProgramRunError);
    expect(await allRuns()).toEqual([]);
  });

  it('ends the run that was active in the same save, so only the new one is active', async () => {
    const a = await program([1], 'A');
    const b = await program([1], 'B');
    const first = await startProgramRun(db, USER, a.programId, opts);
    const second = await startProgramRun(db, USER, b.programId, { now: T1, newId });
    const rows = await allRuns();
    expect(rows.find((r) => r.id === first.id)?.ended_at).toBe(T1);
    expect(rows.find((r) => r.id === second.id)?.ended_at).toBeNull();
    expect((await readActiveRun(db, USER))?.tree.program.name).toBe('B');
  });

  it('never ends a run before it started (a phone whose clock is behind)', async () => {
    const a = await program([1], 'A');
    const b = await program([1], 'B');
    const first = await startProgramRun(db, USER, a.programId, { now: T1, newId });
    await startProgramRun(db, USER, b.programId, { now: T0, newId });
    expect((await allRuns()).find((r) => r.id === first.id)?.ended_at).toBe(T1);
  });
});

describe('stopProgramRun', () => {
  it('ends every active run (stragglers too), clamped to each start; does nothing without one', async () => {
    await stopProgramRun(db, USER, opts);
    expect(await pendingRows(db, 'program_runs')).toEqual([]);

    const { programId } = await program([1]);
    // Two active rows, as two offline phones could leave them.
    const base = { user_id: USER, program_id: programId, next_week_position: 0, next_workout_position: 0, ended_at: null, created_at: T0, updated_at: T0 };
    await writeLocal(db, 'program_runs', [
      { ...base, id: 'c0000000-0000-4000-8000-000000000001', started_at: T0 },
      { ...base, id: 'c0000000-0000-4000-8000-000000000002', started_at: T1 },
    ]);
    await stopProgramRun(db, USER, { now: '2026-11-15T10:30:00.000Z' });
    expect((await allRuns()).map((r) => r.ended_at)).toEqual(['2026-11-15T10:30:00.000Z', T1]);
    expect(await readActiveRun(db, USER)).toBeNull();
  });
});

describe('readActiveRun', () => {
  it('reads the newest active run when two exist, and only the lifter’s own', async () => {
    const a = await program([1], 'A');
    const b = await program([1], 'B');
    const base = { user_id: USER, next_week_position: 0, next_workout_position: 0, ended_at: null, created_at: T0, updated_at: T0 };
    await writeLocal(db, 'program_runs', [
      { ...base, id: 'c0000000-0000-4000-8000-000000000009', program_id: a.programId, started_at: T0 },
      { ...base, id: 'c0000000-0000-4000-8000-000000000001', program_id: b.programId, started_at: T1 },
    ]);
    expect((await readActiveRun(db, USER))?.tree.program.name).toBe('B');
    expect(await readActiveRun(db, OTHER)).toBeNull();
  });

  it('is null when the run’s program was deleted', async () => {
    const { programId } = await program([1]);
    await startProgramRun(db, USER, programId, opts);
    await deleteProgram(db, USER, programId, opts);
    expect(await readActiveRun(db, USER)).toBeNull();
  });

  it('slides to the session now standing where a deleted one stood; reports none when the rest is gone', async () => {
    const { programId, weeks } = await program([3]);
    await startProgramRun(db, USER, programId, opts);
    await removeProgramWorkout(db, USER, weeks[0].workouts[0], opts);
    expect(await nextName()).toBe('W1D2');
    await removeWeek(db, USER, weeks[0].id, opts);
    const active = await readActiveRun(db, USER);
    expect(active).not.toBeNull();
    expect(active?.nextSession).toBeNull();
  });

  it('reaches a week appended mid-run after the existing ones', async () => {
    const { programId, weeks } = await program([1]);
    await startProgramRun(db, USER, programId, opts);
    const run = (await readActiveRun(db, USER))!.run;
    const rows = await advance(weeks[0].workouts[0], T1);
    expect(rows[0].ended_at).toBe(T1); // without the new week, that was the last session
    const week = await addWeek(db, USER, programId, opts);
    await addProgramWorkout(db, USER, week.id, 'Extra', opts);
    const again = await advance(weeks[0].workouts[0], T1);
    expect(again).toEqual([{ ...run, next_week_position: 1, next_workout_position: 0 }]);
  });
});

describe('advanceRunOnFinish', () => {
  it('points the run one session further, and ends it after the last session', async () => {
    const { programId, weeks } = await program([2, 1]);
    const run = await startProgramRun(db, USER, programId, opts);
    expect(await advance(weeks[0].workouts[0], T1)).toEqual([
      { ...run, next_week_position: 0, next_workout_position: 1 },
    ]);
    expect(await advance(weeks[0].workouts[1], T1)).toEqual([
      { ...run, next_week_position: 1, next_workout_position: 0 },
    ]);
    expect(await advance(weeks[1].workouts[0], T1)).toEqual([{ ...run, ended_at: T1 }]);
    // Read-only: the caller (the logger's finish) saves the rows.
    expect((await readActiveRun(db, USER))?.run.next_workout_position).toBe(0);
  });

  it('clamps the completion time to the run’s start', async () => {
    const { programId, weeks } = await program([1]);
    const run = await startProgramRun(db, USER, programId, { now: T1, newId });
    expect(await advance(weeks[0].workouts[0], T0)).toEqual([{ ...run, ended_at: T1 }]);
  });

  it('moves nothing with no run, for another program’s session, or when the program is gone', async () => {
    const a = await program([2], 'A');
    const b = await program([2], 'B');
    expect(await advance(a.weeks[0].workouts[0], T1)).toEqual([]);
    await startProgramRun(db, USER, a.programId, opts);
    expect(await advance(b.weeks[0].workouts[0], T1)).toEqual([]);
    expect(await advance('b0000000-0000-4000-8000-999999999999', T1)).toEqual([]);
    await deleteProgram(db, USER, a.programId, opts);
    expect(await advance(a.weeks[0].workouts[0], T1)).toEqual([]);
  });

  it('moves nothing for a session started before the run (it belonged to an earlier run of the program)', async () => {
    const { programId, weeks } = await program([3]);
    await startProgramRun(db, USER, programId, { now: T1, newId });
    expect(await advance(weeks[0].workouts[0], '2026-11-15T12:00:00.000Z', T0)).toEqual([]);
  });

  it('advances from a finished session the author has since deleted, by where it stood', async () => {
    const { programId, weeks } = await program([3]);
    const run = await startProgramRun(db, USER, programId, opts);
    await removeProgramWorkout(db, USER, weeks[0].workouts[0], opts);
    expect(await advance(weeks[0].workouts[0], T1)).toEqual([
      { ...run, next_week_position: 0, next_workout_position: 1 },
    ]);
  });
});

describe('sync', () => {
  it('a run started offline uploads once and a second phone resolves the same next session', async () => {
    const server = new FakeServer();
    server.offline = true;
    const { programId } = await program([2]);
    const run = await startProgramRun(db, USER, programId, opts);
    await expect(pushOutbox(db, server)).rejects.toThrow();

    server.offline = false;
    const pushed = await pushOutbox(db, server);
    expect(pushed.pushed.program_runs).toBe(1);
    expect(server.tables.program_runs.get(run.id)).toMatchObject({ program_id: programId, ended_at: null });

    const phone2 = await prepareDatabase(createNodeSqliteDriver());
    const pulled = await pullChanges(phone2, server, USER);
    expect(pulled.program_runs).toBe(1);
    const active = await readActiveRun(phone2, USER);
    expect(active?.run.id).toBe(run.id);
    expect(active?.nextSession?.workout.label).toBe('W1D1');
    // Another user's download never sees it.
    const stranger = await prepareDatabase(createNodeSqliteDriver());
    expect((await pullChanges(stranger, server, OTHER)).program_runs).toBe(0);
  });

  it('the fake server, like the real one, refuses a run naming a program it does not hold', async () => {
    const server = new FakeServer();
    const { programId } = await program([1]);
    const run = await startProgramRun(db, USER, programId, opts);
    const { updated_at: _u, ...row } = run;
    await expect(server.upsert('program_runs', [row])).rejects.toThrow(/foreign key/);
  });
});
