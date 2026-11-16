/**
 * Tests for copying a pushed / assigned program into a member's own programs (B37), on real
 * SQLite: the copy is member-owned and ordered like the payload, renumbered 0, 1, 2…; every row
 * is queued for upload; a slot naming an exercise this phone can't use (the coach's custom)
 * arrives with no exercise and is counted; and — the TEAM-3 definition of done — copy → start a
 * run → `readActiveRun` resolves the copy with Week 1's first workout as the next session.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import type { SqlDriver } from '@/db/driver';
import { libraryExerciseId } from '@/library/uuidv5';
import type { TeamProgramPayload } from '@/social/teamCoaching';
import { pendingRows } from '@/sync/outbox';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { createProgramFromPayload, skippedExercisesLine } from './copyProgram';
import { readActiveRun, startProgramRun } from './programRuns';
import { DELETED_EXERCISE_NAME, readProgramTree } from './programs';

const MEMBER = 'a0000000-0000-4000-8000-000000000001';
const T0 = '2026-11-15T10:00:00.000Z';
const BENCH = libraryExerciseId('bench_press');
const COACH_CUSTOM = 'c0000000-0000-4000-8000-0000000000ff';

let db: SqlDriver;
let ids = 0;
const newId = () => `b0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

beforeEach(async () => {
  ids = 0;
  db = await prepareDatabase(createNodeSqliteDriver());
});

const slot = (exerciseId: string | null, extra: Partial<TeamProgramPayload['weeks'][0]['workouts'][0]['exercises'][0]> = {}) => ({
  exerciseId,
  exerciseName: 'Bench Press',
  position: 7,
  targetSets: 3,
  targetReps: 5,
  targetWeightKg: 100,
  targetRpe: 8,
  ...extra,
});

const payload: TeamProgramPayload = {
  name: '  Coach Block ',
  weeks: [
    {
      position: 4,
      workouts: [
        { name: 'Day A', position: 9, exercises: [slot(BENCH), slot(COACH_CUSTOM, { exerciseName: 'Coach Sled' })] },
        { name: null, position: 12, exercises: [slot(BENCH, { targetReps: null, targetWeightKg: null, targetRpe: null })] },
      ],
    },
    { position: 8, workouts: [{ name: 'Day C', position: 0, exercises: [] }] },
  ],
};

describe('createProgramFromPayload', () => {
  it('writes a member-owned copy in the payload’s order, renumbered from 0', async () => {
    const copy = await createProgramFromPayload(db, MEMBER, payload, { now: T0, newId });
    expect(copy.skippedExercises).toBe(1);
    const tree = await readProgramTree(db, MEMBER, copy.programId);
    expect(tree?.program).toMatchObject({ name: 'Coach Block', user_id: MEMBER });
    expect(tree?.weeks.map((w) => w.week.position)).toEqual([0, 1]);
    const [dayA, unnamed] = tree!.weeks[0].workouts;
    expect([dayA.label, unnamed.label, dayA.workout.position, unnamed.workout.position]).toEqual(['Day A', 'Workout 2', 0, 1]);
    expect(dayA.exercises.map((e) => [e.slot.position, e.slot.exercise_id, e.exerciseName])).toEqual([
      [0, BENCH, 'Bench Press'],
      [1, null, DELETED_EXERCISE_NAME],
    ]);
    expect(dayA.exercises[0].slot).toMatchObject({ target_sets: 3, target_reps: 5, target_weight_kg: 100, target_rpe: 8 });
    expect(unnamed.exercises[0].slot).toMatchObject({ target_reps: null, target_weight_kg: null, target_rpe: null });
    expect(tree?.weeks[1].workouts[0].exercises).toEqual([]);
  });

  it('queues every copied row for upload', async () => {
    await createProgramFromPayload(db, MEMBER, payload, { now: T0, newId });
    expect(await pendingRows(db, 'programs')).toHaveLength(1);
    expect(await pendingRows(db, 'program_weeks')).toHaveLength(2);
    expect(await pendingRows(db, 'program_workouts')).toHaveLength(3);
    expect(await pendingRows(db, 'program_exercises')).toHaveLength(3);
  });

  it('saves nothing when a name breaks the server’s rule', async () => {
    await expect(createProgramFromPayload(db, MEMBER, { ...payload, name: '   ' }, { now: T0, newId })).rejects.toThrow(RangeError);
    expect(await pendingRows(db, 'programs')).toHaveLength(0);
  });

  it('an assigned program becomes the active run once started (TEAM-3)', async () => {
    const copy = await createProgramFromPayload(db, MEMBER, payload, { now: T0, newId });
    await startProgramRun(db, MEMBER, copy.programId, { now: T0, newId });
    const active = await readActiveRun(db, MEMBER);
    expect(active?.tree.program.id).toBe(copy.programId);
    expect(active?.nextSession?.workout.label).toBe('Day A');
    expect(active?.nextSession?.week.number).toBe(1);
  });
});

describe('skippedExercisesLine', () => {
  it('says nothing when everything copied, and counts otherwise', () => {
    expect(skippedExercisesLine(0)).toBeNull();
    expect(skippedExercisesLine(1)).toMatch(/^1 exercise is/);
    expect(skippedExercisesLine(2)).toMatch(/^2 exercises are/);
  });

  it('names the coach on a team and the author on the Marketplace (B40)', () => {
    expect(skippedExercisesLine(1)).toBe('1 exercise is the coach’s own and didn’t copy.');
    expect(skippedExercisesLine(2, 'author')).toBe('2 exercises are the author’s own and didn’t copy.');
  });
});
