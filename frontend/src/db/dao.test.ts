/**
 * Tests for the device data-access layer on real SQLite: the user-change
 * write path (row + outbox + touch-the-root, all or nothing) and the
 * server/seed write path (no outbox).
 */
import { describe, expect, it, jest } from '@jest/globals';

import { outboxSize, pendingRows } from '@/sync/outbox';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { ENTRIES, makeSet, SETS, USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { prepareDatabase } from './database';
import { getRowsByIds, onLocalWrite, upsertRows, writeLocal } from './dao';

const LATER = '2026-11-14T11:00:00.000Z';

async function freshDb() {
  return prepareDatabase(createNodeSqliteDriver());
}

describe('writeLocal', () => {
  it('saves a whole workout tree and queues every row for upload', async () => {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT]);
    await writeLocal(db, 'workout_exercises', ENTRIES);
    await writeLocal(db, 'sets', SETS);

    expect((await pendingRows(db, 'workouts')).map((p) => p.rowId)).toEqual([WORKOUT.id]);
    expect(await pendingRows(db, 'workout_exercises')).toHaveLength(2);
    expect(await pendingRows(db, 'sets')).toHaveLength(5);
  });

  it('round-trips every column, including yes/no and decimal values', async () => {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT], { now: LATER });
    await writeLocal(db, 'workout_exercises', ENTRIES, { now: LATER });
    const set = makeSet(0, 0, { is_warmup: true, weight_kg: 102.5, rpe: 7.5, reps: null, duration_seconds: 30 });
    await writeLocal(db, 'sets', [set], { now: LATER });

    expect(await getRowsByIds(db, 'sets', [set.id])).toEqual([{ ...set, updated_at: LATER }]);
    expect(await getRowsByIds(db, 'workouts', [WORKOUT.id])).toEqual([{ ...WORKOUT, updated_at: LATER }]);
  });

  it('stamps updated_at on the rows it writes', async () => {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT], { now: LATER });
    const [row] = await getRowsByIds(db, 'workouts', [WORKOUT.id]);
    expect(row.updated_at).toBe(LATER);
    expect(row.created_at).toBe(WORKOUT.created_at);
  });

  it('touches the root: changing a set re-stamps and re-queues its workout', async () => {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT], { now: '2026-11-14T09:30:00.000Z' });
    await writeLocal(db, 'workout_exercises', ENTRIES, { now: '2026-11-14T09:30:00.000Z' });
    await writeLocal(db, 'sets', SETS, { now: '2026-11-14T09:30:00.000Z' });
    const before = await pendingRows(db, 'workouts');

    await writeLocal(db, 'sets', [{ ...SETS[3], reps: 3 }], { now: LATER });

    const [workout] = await getRowsByIds(db, 'workouts', [WORKOUT.id]);
    expect(workout.updated_at).toBe(LATER);
    const after = await pendingRows(db, 'workouts');
    expect(after[0].mark).toBeGreaterThan(before[0].mark);
  });

  it('touches the root for entries too', async () => {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT], { now: '2026-11-14T09:30:00.000Z' });
    await writeLocal(db, 'workout_exercises', [{ ...ENTRIES[0], notes: 'paused reps' }], { now: LATER });
    const [workout] = await getRowsByIds(db, 'workouts', [WORKOUT.id]);
    expect(workout.updated_at).toBe(LATER);
  });

  it('is all-or-nothing: a failure part-way leaves no rows and no outbox lines', async () => {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT]);
    await writeLocal(db, 'workout_exercises', ENTRIES);
    const linesBefore = await outboxSize(db);

    // The second set points at an entry that doesn't exist: the foreign key
    // fails after the first set has already been written inside the transaction.
    const orphan = { ...makeSet(0, 7), workout_exercise_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
    await expect(writeLocal(db, 'sets', [SETS[0], orphan])).rejects.toThrow();

    expect(await getRowsByIds(db, 'sets', [SETS[0].id])).toEqual([]);
    expect(await outboxSize(db)).toBe(linesBefore);
  });

  it('refuses to queue a library exercise (owner_id null) and writes nothing', async () => {
    const db = await freshDb();
    const library = {
      id: 'd0000000-0000-4000-8000-000000000001',
      owner_id: null,
      name: 'Made Up',
      primary_muscle: null,
      equipment: null,
      slug: 'made_up',
      created_at: LATER,
      updated_at: LATER,
    };
    await expect(writeLocal(db, 'exercises', [library])).rejects.toThrow('Library exercises');
    expect(await outboxSize(db)).toBe(0);
  });

  it('queues a custom exercise owned by the user', async () => {
    const db = await freshDb();
    const custom = {
      id: 'd0000000-0000-4000-8000-000000000002',
      owner_id: USER_ID,
      name: 'Landmine Press',
      primary_muscle: 'Shoulders',
      equipment: 'Barbell',
      slug: null,
      created_at: LATER,
      updated_at: LATER,
    };
    await writeLocal(db, 'exercises', [custom]);
    expect((await pendingRows(db, 'exercises')).map((p) => p.rowId)).toEqual([custom.id]);
  });

  it('tells local-write listeners after the change commits, and stops after unsubscribe', async () => {
    const db = await freshDb();
    const listener = jest.fn();
    const unsubscribe = onLocalWrite(db, listener);
    await writeLocal(db, 'workouts', [WORKOUT]);
    expect(listener).toHaveBeenCalledWith('workouts');
    unsubscribe();
    await writeLocal(db, 'workouts', [WORKOUT]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty list', async () => {
    const db = await freshDb();
    await writeLocal(db, 'sets', []);
    expect(await outboxSize(db)).toBe(0);
  });
});

describe('upsertRows', () => {
  it('saves server rows without queueing them', async () => {
    const db = await freshDb();
    await upsertRows(db, 'workouts', [WORKOUT]);
    expect(await getRowsByIds(db, 'workouts', [WORKOUT.id])).toEqual([WORKOUT]);
    expect(await outboxSize(db)).toBe(0);
  });

  it('updates a workout in place without deleting the sets inside it', async () => {
    const db = await freshDb();
    await upsertRows(db, 'workouts', [WORKOUT]);
    await upsertRows(db, 'workout_exercises', ENTRIES);
    await upsertRows(db, 'sets', SETS);
    await upsertRows(db, 'workouts', [{ ...WORKOUT, title: 'Renamed' }]);
    expect((await getRowsByIds(db, 'workouts', [WORKOUT.id]))[0].title).toBe('Renamed');
    expect(
      await getRowsByIds(
        db,
        'sets',
        SETS.map((s) => s.id),
      ),
    ).toHaveLength(5);
  });
});
