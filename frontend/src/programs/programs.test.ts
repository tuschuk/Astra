/**
 * Tests for the program module (PRG-1, PRG-2, B34): creating, editing and soft-deleting programs,
 * weeks, workouts and exercise slots; the live-chain ownership checks (someone else's or a deleted
 * node is refused, and an edit can't resurrect a deleted row); target validation and kg storage;
 * the tree read's order, filtering and exercise naming; and the step DoD — a complete program
 * authored through the module reopens intact from a closed-and-reopened database file, lands on
 * the (fake) server exactly once after an offline spell, and a second phone downloads the same
 * tree. Real SQLite (node driver); the fake server stands in for Supabase.
 */
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lbToKg, roundWeightKgForStorage } from '@training-math';

import { prepareDatabase } from '@/db/database';
import { getRowsByIds } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { createCustomExercise, deleteCustomExercise } from '@/library/customExercises';
import { exerciseById } from '@/library/catalog';
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
  DELETED_EXERCISE_NAME,
  deleteProgram,
  formatProgramSize,
  formatProgramTargets,
  getProgram,
  listPrograms,
  moveProgramExercise,
  PROGRAM_VISIBILITY_ORDER,
  PROGRAM_VISIBILITY_WORDS,
  setProgramVisibility,
  readProgramTree,
  readProgramWorkout,
  removeProgramExercise,
  removeProgramWorkout,
  removeWeek,
  renameProgram,
  renameProgramWorkout,
  updateProgramExercise,
  type ProgramTargetsInput,
} from './programs';

const USER = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const T0 = '2026-11-15T10:00:00.000Z';
const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
const SQUAT_NAME = exerciseById('squat')?.name;
const BENCH_NAME = exerciseById('bench_press')?.name;

let db: SqlDriver;
let ids = 0;
/** Predictable ids for new rows. */
const newId = () => `b0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const opts = { now: T0, newId };

/** Targets with every field. */
const full = (sets: number, reps: number, lb: number, rpe: number): ProgramTargetsInput => ({
  sets,
  reps,
  weight: { value: lb, unit: 'lb' },
  rpe,
});
/** Sets-only targets (a bodyweight move with no load). */
const setsOnly = (sets: number): ProgramTargetsInput => ({ sets, reps: null, weight: null, rpe: null });

const tempDirs: string[] = [];
afterAll(() => {
  // Best effort: the test driver keeps its file open, which Windows refuses to delete.
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // left for the OS's temp cleanup
    }
  }
});

beforeEach(async () => {
  db = await prepareDatabase(createNodeSqliteDriver());
  ids = 0;
});

/**
 * Authors the DoD program on `target`: 2 weeks × 2 workouts, a library and a custom exercise,
 * full and partial targets. Returns the program id.
 */
async function authorCompleteProgram(target: SqlDriver): Promise<string> {
  const curl = await createCustomExercise(target, USER, { name: 'Spider Curl', equipment: null, primaryMuscle: null }, opts);
  const program = await createProgram(target, USER, '  Strength Block ', opts);
  for (let w = 0; w < 2; w++) {
    const week = await addWeek(target, USER, program.id, opts);
    const dayA = await addProgramWorkout(target, USER, week.id, 'Day A', opts);
    await addProgramExercise(target, USER, dayA.id, { exerciseId: SQUAT, targets: full(5, 5, 225 + w * 10, 8) }, opts);
    await addProgramExercise(target, USER, dayA.id, { exerciseId: curl.id, targets: setsOnly(3) }, opts);
    const dayB = await addProgramWorkout(target, USER, week.id, null, opts);
    await addProgramExercise(
      target,
      USER,
      dayB.id,
      { exerciseId: BENCH, targets: { sets: 4, reps: 8, weight: null, rpe: 7.5 } },
      opts,
    );
  }
  return program.id;
}

describe('programs', () => {
  it('creates a trimmed, owned, live program and queues it', async () => {
    const program = await createProgram(db, USER, '  PPL  ', opts);
    expect(program).toEqual({
      id: 'b0000000-0000-4000-8000-000000000001',
      user_id: USER,
      name: 'PPL',
      visibility: 'private',
      deleted_at: null,
      created_at: T0,
      updated_at: T0,
    });
    expect((await pendingRows(db, 'programs')).map((p) => p.rowId)).toEqual([program.id]);
  });

  it('refuses an empty or over-long name before saving anything', async () => {
    await expect(createProgram(db, USER, '   ', opts)).rejects.toThrow(RangeError);
    await expect(createProgram(db, USER, 'x'.repeat(101), opts)).rejects.toThrow(RangeError);
    expect(await listPrograms(db, USER)).toEqual([]);
  });

  it('renames, lists newest first with sizes, and soft-deletes', async () => {
    const older = await createProgram(db, USER, 'Old', { now: '2026-11-01T00:00:00.000Z', newId });
    const newer = await createProgram(db, USER, 'New', opts);
    const week = await addWeek(db, USER, newer.id, opts);
    await addProgramWorkout(db, USER, week.id, null, opts);
    await addProgramWorkout(db, USER, week.id, null, opts);
    await createProgram(db, OTHER, 'Not mine', opts);

    await renameProgram(db, USER, older.id, ' Older ', opts);
    const list = await listPrograms(db, USER);
    expect(list.map((s) => [s.program.name, s.weekCount, s.workoutCount])).toEqual([
      ['New', 1, 2],
      ['Older', 0, 0],
    ]);

    await deleteProgram(db, USER, older.id, opts);
    expect((await listPrograms(db, USER)).map((s) => s.program.id)).toEqual([newer.id]);
    expect(await getProgram(db, USER, older.id)).toBeNull();
    // The row stays, stamped — a soft delete.
    const [kept] = await getRowsByIds(db, 'programs', [older.id]);
    expect(kept.deleted_at).toBe(T0);
  });

  it('never resurrects a deleted program and refuses someone else’s', async () => {
    const program = await createProgram(db, USER, 'Mine', opts);
    const theirs = await createProgram(db, OTHER, 'Theirs', opts);
    await deleteProgram(db, USER, program.id, opts);
    await expect(renameProgram(db, USER, program.id, 'Back')).rejects.toThrow();
    await expect(addWeek(db, USER, program.id)).rejects.toThrow();
    await expect(renameProgram(db, USER, theirs.id, 'Stolen')).rejects.toThrow();
    await expect(addWeek(db, USER, theirs.id)).rejects.toThrow();
    expect(await getProgram(db, USER, theirs.id)).toBeNull();
    const [row] = await getRowsByIds(db, 'programs', [program.id]);
    expect(row.name).toBe('Mine');
    expect(row.deleted_at).not.toBeNull();
  });
});

describe('visibility (PRG-4, B39)', () => {
  it('changes who can see a program on the phone, queues it, and every read carries it', async () => {
    const program = await createProgram(db, USER, 'Shared', opts);
    await pushOutbox(db, new FakeServer()); // empty the queue so only the change is pending
    const later = '2026-11-15T11:00:00.000Z';
    const saved = await setProgramVisibility(db, USER, program.id, 'followers', { now: later });
    expect(saved).toMatchObject({ id: program.id, visibility: 'followers', updated_at: later });
    expect((await pendingRows(db, 'programs')).map((p) => p.rowId)).toEqual([program.id]);
    expect((await getProgram(db, USER, program.id))?.visibility).toBe('followers');
    expect((await readProgramTree(db, USER, program.id))?.program.visibility).toBe('followers');
    expect((await listPrograms(db, USER))[0].program.visibility).toBe('followers');
    // A rename keeps the choice (it copies the whole row).
    await renameProgram(db, USER, program.id, 'Renamed', opts);
    expect((await getProgram(db, USER, program.id))?.visibility).toBe('followers');
  });

  it('refuses someone else’s, a deleted program, and an unknown level', async () => {
    const mine = await createProgram(db, USER, 'Mine', opts);
    const theirs = await createProgram(db, OTHER, 'Theirs', opts);
    await expect(setProgramVisibility(db, USER, theirs.id, 'published')).rejects.toThrow();
    await expect(setProgramVisibility(db, USER, mine.id, 'everyone' as never)).rejects.toThrow(RangeError);
    await deleteProgram(db, USER, mine.id, opts);
    await expect(setProgramVisibility(db, USER, mine.id, 'published')).rejects.toThrow();
    const rows = await getRowsByIds(db, 'programs', [mine.id, theirs.id]);
    expect(rows.map((r) => r.visibility)).toEqual(['private', 'private']);
  });

  it('the words table names every level, in chip order', () => {
    expect(PROGRAM_VISIBILITY_ORDER).toEqual(['private', 'followers', 'team', 'published']);
    expect(PROGRAM_VISIBILITY_ORDER.map((v) => PROGRAM_VISIBILITY_WORDS[v].label)).toEqual([
      'Only you',
      'Followers',
      'Team',
      'Published',
    ]);
  });

  it('rides the sync both ways: uploaded, and pulled onto the author’s other phone', async () => {
    const server = new FakeServer();
    const program = await createProgram(db, USER, 'Team block', opts);
    await setProgramVisibility(db, USER, program.id, 'team', opts);
    await pushOutbox(db, server);
    expect(server.tables.programs.get(program.id)).toMatchObject({ visibility: 'team' });
    const phone2 = await prepareDatabase(createNodeSqliteDriver());
    await pullChanges(phone2, server, USER);
    expect((await getProgram(phone2, USER, program.id))?.visibility).toBe('team');
  });
});

describe('weeks and workouts', () => {
  it('numbers weeks and workouts in order and labels unnamed workouts', async () => {
    const program = await createProgram(db, USER, 'P', opts);
    const w1 = await addWeek(db, USER, program.id, opts);
    const w2 = await addWeek(db, USER, program.id, opts);
    expect([w1.position, w2.position]).toEqual([0, 1]);
    await addProgramWorkout(db, USER, w1.id, '  Heavy  ', opts);
    await addProgramWorkout(db, USER, w1.id, '   ', opts);

    const tree = await readProgramTree(db, USER, program.id);
    expect(tree?.weeks.map((w) => w.number)).toEqual([1, 2]);
    expect(tree?.weeks[0].workouts.map((w) => [w.workout.name, w.label])).toEqual([
      ['Heavy', 'Heavy'],
      [null, 'Workout 2'],
    ]);
  });

  it('renames a workout (blank clears it) and refuses a name over 100', async () => {
    const program = await createProgram(db, USER, 'P', opts);
    const week = await addWeek(db, USER, program.id, opts);
    const workout = await addProgramWorkout(db, USER, week.id, 'Day A', opts);
    expect((await renameProgramWorkout(db, USER, workout.id, 'Pull', opts)).name).toBe('Pull');
    expect((await renameProgramWorkout(db, USER, workout.id, '  ', opts)).name).toBeNull();
    await expect(renameProgramWorkout(db, USER, workout.id, 'x'.repeat(101))).rejects.toThrow(RangeError);
  });

  it('removing a week hides its workouts; edits inside it are refused', async () => {
    const program = await createProgram(db, USER, 'P', opts);
    const w1 = await addWeek(db, USER, program.id, opts);
    const w2 = await addWeek(db, USER, program.id, opts);
    const inside = await addProgramWorkout(db, USER, w1.id, 'Gone with the week', opts);
    await addProgramWorkout(db, USER, w2.id, 'Stays', opts);

    await removeWeek(db, USER, w1.id, opts);
    const tree = await readProgramTree(db, USER, program.id);
    expect(tree?.weeks.map((w) => w.week.id)).toEqual([w2.id]);
    expect(tree?.weeks[0].number).toBe(1);
    // Only the week was stamped; its workout is untouched but unreachable.
    const [workoutRow] = await getRowsByIds(db, 'program_workouts', [inside.id]);
    expect(workoutRow.deleted_at).toBeNull();
    await expect(renameProgramWorkout(db, USER, inside.id, 'x')).rejects.toThrow();
    await expect(addProgramWorkout(db, USER, w1.id)).rejects.toThrow();
    expect(await readProgramWorkout(db, USER, inside.id)).toBeNull();
    expect((await listPrograms(db, USER))[0]).toMatchObject({ weekCount: 1, workoutCount: 1 });
  });

  it('removes a workout and appends after the highest live position', async () => {
    const program = await createProgram(db, USER, 'P', opts);
    const week = await addWeek(db, USER, program.id, opts);
    const a = await addProgramWorkout(db, USER, week.id, 'A', opts);
    const b = await addProgramWorkout(db, USER, week.id, 'B', opts);
    await removeProgramWorkout(db, USER, b.id, opts);
    const c = await addProgramWorkout(db, USER, week.id, 'C', opts);
    expect([a.position, c.position]).toEqual([0, 1]);
    const tree = await readProgramTree(db, USER, program.id);
    expect(tree?.weeks[0].workouts.map((w) => w.label)).toEqual(['A', 'C']);
  });
});

describe('exercise slots', () => {
  async function workoutFixture() {
    const program = await createProgram(db, USER, 'P', opts);
    const week = await addWeek(db, USER, program.id, opts);
    const workout = await addProgramWorkout(db, USER, week.id, 'Day A', opts);
    return { program, week, workout };
  }

  it('stores targets in kg rounded like the server, RPE to one decimal, optional fields as null', async () => {
    const { workout } = await workoutFixture();
    const heavy = await addProgramExercise(db, USER, workout.id, { exerciseId: SQUAT, targets: full(5, 5, 225, 8.04) }, opts);
    expect(heavy).toMatchObject({
      exercise_id: SQUAT,
      position: 0,
      target_sets: 5,
      target_reps: 5,
      target_weight_kg: roundWeightKgForStorage(lbToKg(225)),
      target_rpe: 8,
    });
    const kg = await addProgramExercise(
      db,
      USER,
      workout.id,
      { exerciseId: BENCH, targets: { sets: 3, reps: null, weight: { value: 60.004, unit: 'kg' }, rpe: null } },
      opts,
    );
    expect(kg).toMatchObject({ position: 1, target_reps: null, target_weight_kg: 60, target_rpe: null });
  });

  it.each([
    [{ sets: 0, reps: null, weight: null, rpe: null }],
    [{ sets: 3, reps: 2.5, weight: null, rpe: null }],
    [{ sets: 3, reps: 5, weight: { value: 10000, unit: 'kg' as const }, rpe: null }],
    [{ sets: 3, reps: 5, weight: null, rpe: 11 }],
  ])('refuses targets the server would refuse: %o', async (targets) => {
    const { workout } = await workoutFixture();
    await expect(addProgramExercise(db, USER, workout.id, { exerciseId: SQUAT, targets })).rejects.toThrow(RangeError);
    expect(await pendingRows(db, 'program_exercises')).toEqual([]);
  });

  it('refuses an exercise the lifter can’t use: unknown, someone else’s custom, or a deleted custom', async () => {
    const { workout } = await workoutFixture();
    const theirs = await createCustomExercise(db, OTHER, { name: 'Theirs', equipment: null, primaryMuscle: null }, opts);
    const mine = await createCustomExercise(db, USER, { name: 'Mine', equipment: null, primaryMuscle: null }, opts);
    await deleteCustomExercise(db, USER, mine.id, opts);
    for (const exerciseId of ['c0000000-0000-4000-8000-00000000dead', theirs.id, mine.id]) {
      await expect(addProgramExercise(db, USER, workout.id, { exerciseId, targets: setsOnly(3) })).rejects.toThrow();
    }
  });

  it('updates targets in place, keeping the exercise and position', async () => {
    const { workout } = await workoutFixture();
    const slot = await addProgramExercise(db, USER, workout.id, { exerciseId: SQUAT, targets: setsOnly(3) }, opts);
    const updated = await updateProgramExercise(db, USER, slot.id, full(4, 6, 200, 9), opts);
    expect(updated).toMatchObject({ exercise_id: SQUAT, position: 0, target_sets: 4, target_reps: 6, target_rpe: 9 });
    await expect(updateProgramExercise(db, USER, slot.id, setsOnly(0))).rejects.toThrow(RangeError);
  });

  it('moves slots up and down, renumbering ties, and ignores moves past either end', async () => {
    const { program, workout } = await workoutFixture();
    const a = await addProgramExercise(db, USER, workout.id, { exerciseId: SQUAT, targets: setsOnly(1) }, opts);
    const b = await addProgramExercise(db, USER, workout.id, { exerciseId: BENCH, targets: setsOnly(2) }, opts);
    // A tie, as two offline adds on two phones would leave it.
    const c = await addProgramExercise(db, USER, workout.id, { exerciseId: SQUAT, targets: setsOnly(3) }, opts);
    await db.runAsync('update program_exercises set position = 1 where id = ?', [c.id]);

    const order = async () =>
      (await readProgramTree(db, USER, program.id))?.weeks[0].workouts[0].exercises.map((e) => e.slot.id);
    expect(await order()).toEqual([a.id, b.id, c.id]); // tie broken by id
    await moveProgramExercise(db, USER, c.id, 'up', opts);
    expect(await order()).toEqual([a.id, c.id, b.id]);
    await moveProgramExercise(db, USER, a.id, 'up', opts);
    await moveProgramExercise(db, USER, b.id, 'down', opts);
    expect(await order()).toEqual([a.id, c.id, b.id]);
    await moveProgramExercise(db, USER, a.id, 'down', opts);
    expect(await order()).toEqual([c.id, a.id, b.id]);
    const positions = (await readProgramTree(db, USER, program.id))?.weeks[0].workouts[0].exercises.map(
      (e) => e.slot.position,
    );
    expect(positions).toEqual([0, 1, 2]);
  });

  it('removes a slot, and a removed slot can’t be edited back', async () => {
    const { program, workout } = await workoutFixture();
    const slot = await addProgramExercise(db, USER, workout.id, { exerciseId: SQUAT, targets: setsOnly(3) }, opts);
    await removeProgramExercise(db, USER, slot.id, opts);
    expect((await readProgramTree(db, USER, program.id))?.weeks[0].workouts[0].exercises).toEqual([]);
    await expect(updateProgramExercise(db, USER, slot.id, setsOnly(5))).rejects.toThrow();
    await expect(moveProgramExercise(db, USER, slot.id, 'up')).rejects.toThrow();
  });

  it('names a deleted custom by its name and a vanished exercise as “Deleted exercise”', async () => {
    const { program, workout } = await workoutFixture();
    const curl = await createCustomExercise(db, USER, { name: 'Spider Curl', equipment: null, primaryMuscle: null }, opts);
    await addProgramExercise(db, USER, workout.id, { exerciseId: curl.id, targets: setsOnly(3) }, opts);
    const gone = await addProgramExercise(db, USER, workout.id, { exerciseId: SQUAT, targets: setsOnly(3) }, opts);
    await deleteCustomExercise(db, USER, curl.id, opts);
    // As if the server's `on delete set null` had come down.
    await db.runAsync('update program_exercises set exercise_id = null where id = ?', [gone.id]);
    const names = (await readProgramTree(db, USER, program.id))?.weeks[0].workouts[0].exercises.map((e) => e.exerciseName);
    expect(names).toEqual(['Spider Curl', DELETED_EXERCISE_NAME]);
  });
});

describe('readProgramTree', () => {
  it('is null for an unknown, someone else’s or a deleted program', async () => {
    const theirs = await createProgram(db, OTHER, 'Theirs', opts);
    const mine = await createProgram(db, USER, 'Mine', opts);
    await deleteProgram(db, USER, mine.id, opts);
    expect(await readProgramTree(db, USER, theirs.id)).toBeNull();
    expect(await readProgramTree(db, USER, mine.id)).toBeNull();
    expect(await readProgramTree(db, USER, 'nope')).toBeNull();
  });

  it('locates one workout inside its tree', async () => {
    const programId = await authorCompleteProgram(db);
    const tree = await readProgramTree(db, USER, programId);
    const target = tree!.weeks[1].workouts[1];
    const found = await readProgramWorkout(db, USER, target.workout.id);
    expect(found?.week.number).toBe(2);
    expect(found?.workout).toEqual(target);
    expect(await readProgramWorkout(db, OTHER, target.workout.id)).toBeNull();
  });
});

describe('step DoD: a complete program authors and reopens intact', () => {
  it('reopens intact from the database file after the handle is closed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-programs-'));
    tempDirs.push(dir);
    const file = join(dir, 'astra.db');
    const first = await prepareDatabase(createNodeSqliteDriver(file));
    const programId = await authorCompleteProgram(first);
    const authored = await readProgramTree(first, USER, programId);
    await first.closeAsync?.();

    const reopened = await prepareDatabase(createNodeSqliteDriver(file));
    const tree = await readProgramTree(reopened, USER, programId);
    expect(tree).toEqual(authored);
    expect(tree?.program.name).toBe('Strength Block');
    expect(tree?.weeks).toHaveLength(2);
    expect(tree?.weeks.map((w) => w.workouts.map((x) => x.label))).toEqual([
      ['Day A', 'Workout 2'],
      ['Day A', 'Workout 2'],
    ]);
    expect(tree?.weeks[1].workouts[0].exercises.map((e) => [e.exerciseName, formatProgramTargets(e.slot, 'lb')])).toEqual(
      [
        [SQUAT_NAME, '5 × 5 @ 235 lb · RPE 8'],
        ['Spider Curl', '3 sets'],
      ],
    );
    expect(tree?.weeks[0].workouts[1].exercises.map((e) => [e.exerciseName, formatProgramTargets(e.slot, 'kg')])).toEqual(
      [[BENCH_NAME, '4 × 8 · RPE 7.5']],
    );
  });

  it('lands on the server exactly once after an offline spell, and a second phone pulls the same tree', async () => {
    const server = new FakeServer();
    // The library exists on the server too (same uuidv5 ids as the phone's seed).
    server.seed(
      'exercises',
      (await db.getAllAsync<Record<string, unknown>>('select * from exercises where owner_id is null')).map((r) => ({
        ...(r as object),
        deleted_at: null,
      })) as never,
    );
    server.offline = true;
    const programId = await authorCompleteProgram(db);
    await expect(pushOutbox(db, server)).rejects.toThrow();
    expect(server.tables.programs.size).toBe(0);

    server.offline = false;
    server.loseNextResponse();
    await expect(pushOutbox(db, server)).rejects.toThrow();
    await pushOutbox(db, server);
    expect(server.tables.programs.size).toBe(1);
    expect(server.tables.program_weeks.size).toBe(2);
    expect(server.tables.program_workouts.size).toBe(4);
    expect(server.tables.program_exercises.size).toBe(6);
    for (const tbl of ['programs', 'program_weeks', 'program_workouts', 'program_exercises'] as const) {
      expect(await pendingRows(db, tbl)).toEqual([]);
    }

    const phone2 = await prepareDatabase(createNodeSqliteDriver());
    const result = await pullChanges(phone2, server, USER);
    expect(result).toMatchObject({ programs: 1, program_weeks: 2, program_workouts: 4, program_exercises: 6 });
    const mine = await readProgramTree(db, USER, programId);
    const theirs = await readProgramTree(phone2, USER, programId);
    // Same shape, names, targets and order; only the server's updated_at stamps differ.
    const strip = (tree: typeof mine) =>
      JSON.parse(JSON.stringify(tree, (key, value: unknown) => (key === 'updated_at' ? undefined : value)));
    expect(strip(theirs)).toEqual(strip(mine));

    // Another lifter's phone pulls nothing of it (author-only reads).
    const stranger = await prepareDatabase(createNodeSqliteDriver());
    expect(await pullChanges(stranger, server, OTHER)).toMatchObject({ programs: 0, program_exercises: 0 });
  });

  it('a week that downloads before its program waits unseen, then appears — the sync never fails', async () => {
    const server = new FakeServer();
    const program = await createProgram(db, USER, 'From the other phone', opts);
    const week = await addWeek(db, USER, program.id, opts);
    await pushOutbox(db, server);
    // This phone's programs pass runs just before the other phone's program lands.
    let hideProgramsOnce = true;
    const racing = Object.create(server) as FakeServer;
    racing.pullProgramRows = (async (tbl, userId, after, limit) => {
      if (tbl === 'programs' && hideProgramsOnce) {
        hideProgramsOnce = false;
        return [];
      }
      return server.pullProgramRows(tbl, userId, after, limit);
    }) as FakeServer['pullProgramRows'];

    const phone2 = await prepareDatabase(createNodeSqliteDriver());
    await expect(pullChanges(phone2, racing, USER)).resolves.toMatchObject({ programs: 0, program_weeks: 1 });
    expect(await readProgramTree(phone2, USER, program.id)).toBeNull();
    await pullChanges(phone2, racing, USER);
    expect((await readProgramTree(phone2, USER, program.id))?.weeks.map((w) => w.week.id)).toEqual([week.id]);
  });

  it('uploads parents first: the custom exercise, then program → weeks → workouts → slots', async () => {
    const server = new FakeServer();
    await authorCompleteProgram(db);
    await pushOutbox(db, server);
    expect(server.upsertCalls.map((c) => c.tbl)).toEqual([
      'exercises',
      'programs',
      'program_weeks',
      'program_workouts',
      'program_exercises',
    ]);
  });

  it('a delete reaches the other phone as an update and the program disappears there', async () => {
    const server = new FakeServer();
    const program = await createProgram(db, USER, 'Short lived', opts);
    await pushOutbox(db, server);
    const phone2 = await prepareDatabase(createNodeSqliteDriver());
    await pullChanges(phone2, server, USER);
    expect((await listPrograms(phone2, USER)).map((s) => s.program.id)).toEqual([program.id]);

    await deleteProgram(db, USER, program.id);
    await pushOutbox(db, server);
    expect(server.deleteCalls).toEqual([]);
    await pullChanges(phone2, server, USER);
    expect(await listPrograms(phone2, USER)).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats targets every way they can be set', () => {
    const slot = { target_sets: 3, target_reps: 8, target_weight_kg: roundWeightKgForStorage(lbToKg(135)), target_rpe: 8 };
    expect(formatProgramTargets(slot, 'lb')).toBe('3 × 8 @ 135 lb · RPE 8');
    expect(formatProgramTargets({ ...slot, target_weight_kg: null, target_rpe: null }, 'lb')).toBe('3 × 8');
    expect(formatProgramTargets({ ...slot, target_reps: null, target_weight_kg: 60, target_rpe: null }, 'kg')).toBe(
      '3 sets @ 60 kg',
    );
    expect(formatProgramTargets({ target_sets: 1, target_reps: null, target_weight_kg: null, target_rpe: 7.5 }, 'kg')).toBe(
      '1 set · RPE 7.5',
    );
  });

  it('formats a program’s size', () => {
    expect(formatProgramSize({ weekCount: 1, workoutCount: 1 })).toBe('1 week · 1 workout');
    expect(formatProgramSize({ weekCount: 4, workoutCount: 12 })).toBe('4 weeks · 12 workouts');
  });
});
