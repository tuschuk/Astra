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
import {
  deleteDraftRowsTx,
  deleteLocalRowsTx,
  getRowsByIds,
  onLocalWrite,
  upsertRows,
  writeDraftRows,
  writeLocal,
  writeLocalTree,
} from './dao';

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

const DRAFT = { ...WORKOUT, ended_at: null };

describe('writeDraftRows / deleteDraftRowsTx (the in-progress workout)', () => {
  it('saves draft rows with updated_at stamped, and queues nothing', async () => {
    const db = await freshDb();
    await writeDraftRows(db, 'workouts', [DRAFT], { now: LATER });
    await writeDraftRows(db, 'workout_exercises', ENTRIES, { now: LATER });
    await writeDraftRows(db, 'sets', SETS, { now: LATER });
    expect(await getRowsByIds(db, 'sets', [SETS[1].id])).toEqual([{ ...SETS[1], updated_at: LATER }]);
    expect(await outboxSize(db)).toBe(0);
  });

  it('does not tell local-write listeners (there is nothing to push)', async () => {
    const db = await freshDb();
    const listener = jest.fn();
    onLocalWrite(db, listener);
    await writeDraftRows(db, 'workouts', [DRAFT]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('refuses a finished workout, and rows inside a finished workout', async () => {
    const db = await freshDb();
    await expect(writeDraftRows(db, 'workouts', [WORKOUT])).rejects.toThrow('finished');
    await upsertRows(db, 'workouts', [WORKOUT]);
    await expect(writeDraftRows(db, 'workout_exercises', ENTRIES)).rejects.toThrow('finished');
    await upsertRows(db, 'workout_exercises', ENTRIES);
    await expect(writeDraftRows(db, 'sets', SETS)).rejects.toThrow('finished');
    expect(await getRowsByIds(db, 'sets', [SETS[0].id])).toEqual([]);
    await expect(
      db.withTransactionAsync((tx) => deleteDraftRowsTx(tx, 'workout_exercises', [ENTRIES[0].id])),
    ).rejects.toThrow('finished');
    expect(await getRowsByIds(db, 'workout_exercises', [ENTRIES[0].id])).toHaveLength(1);
  });

  it('deletes draft rows, cascading to the rows inside them', async () => {
    const db = await freshDb();
    await writeDraftRows(db, 'workouts', [DRAFT]);
    await writeDraftRows(db, 'workout_exercises', ENTRIES);
    await writeDraftRows(db, 'sets', SETS);
    await db.withTransactionAsync((tx) => deleteDraftRowsTx(tx, 'sets', [SETS[0].id]));
    expect(await getRowsByIds(db, 'sets', [SETS[0].id])).toEqual([]);
    await db.withTransactionAsync((tx) => deleteDraftRowsTx(tx, 'workout_exercises', [ENTRIES[1].id]));
    expect(await getRowsByIds(db, 'sets', [SETS[3].id, SETS[4].id])).toEqual([]);
    await db.withTransactionAsync((tx) => deleteDraftRowsTx(tx, 'workouts', [DRAFT.id]));
    expect(await db.getAllAsync('select id from sets')).toEqual([]);
    expect(await outboxSize(db)).toBe(0);
  });
});

describe('writeLocalTree', () => {
  it('saves and queues a whole workout in one go, and tells listeners per table', async () => {
    const db = await freshDb();
    const listener = jest.fn();
    onLocalWrite(db, listener);
    await writeLocalTree(db, { workouts: [WORKOUT], workout_exercises: ENTRIES, sets: SETS }, { now: LATER });
    expect((await pendingRows(db, 'workouts')).map((p) => p.rowId)).toEqual([WORKOUT.id]);
    expect(await pendingRows(db, 'workout_exercises')).toHaveLength(2);
    expect(await pendingRows(db, 'sets')).toHaveLength(5);
    expect((await getRowsByIds(db, 'sets', [SETS[2].id]))[0].updated_at).toBe(LATER);
    expect(listener.mock.calls).toEqual([['workouts'], ['workout_exercises'], ['sets']]);
  });

  it('touches the root when the workout itself is not in the tree', async () => {
    const db = await freshDb();
    await upsertRows(db, 'workouts', [WORKOUT]);
    await upsertRows(db, 'workout_exercises', ENTRIES);
    await writeLocalTree(db, { sets: [SETS[0]] }, { now: LATER });
    expect((await getRowsByIds(db, 'workouts', [WORKOUT.id]))[0].updated_at).toBe(LATER);
    expect((await pendingRows(db, 'workouts')).map((p) => p.rowId)).toEqual([WORKOUT.id]);
  });

  it('is all-or-nothing: a bad set at the end leaves no rows and no outbox lines', async () => {
    const db = await freshDb();
    const orphan = { ...makeSet(0, 7), workout_exercise_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
    await expect(
      writeLocalTree(db, { workouts: [WORKOUT], workout_exercises: ENTRIES, sets: [...SETS, orphan] }),
    ).rejects.toThrow();
    expect(await getRowsByIds(db, 'workouts', [WORKOUT.id])).toEqual([]);
    expect(await outboxSize(db)).toBe(0);
  });

  it('does nothing for an empty tree', async () => {
    const db = await freshDb();
    await writeLocalTree(db, {});
    expect(await outboxSize(db)).toBe(0);
  });

  it('B13: saves and queues personal records with the tree, last, without touching any root', async () => {
    const db = await freshDb();
    const listener = jest.fn();
    onLocalWrite(db, listener);
    const record = {
      id: 'd0000000-0000-4000-8000-000000000001',
      user_id: USER_ID,
      exercise_id: ENTRIES[0].exercise_id as string,
      kind: 'repMax' as const,
      reps: 5,
      value_kg: 105,
      source_set_id: SETS[2].id,
      created_at: WORKOUT.created_at,
      updated_at: WORKOUT.created_at,
    };
    await writeLocalTree(
      db,
      { workouts: [WORKOUT], workout_exercises: ENTRIES, sets: SETS, personal_records: [record] },
      { now: LATER },
    );
    expect(await getRowsByIds(db, 'personal_records', [record.id])).toEqual([{ ...record, updated_at: LATER }]);
    expect((await pendingRows(db, 'personal_records')).map((p) => p.rowId)).toEqual([record.id]);
    expect(listener.mock.calls).toEqual([['workouts'], ['workout_exercises'], ['sets'], ['personal_records']]);
  });

  it('B13: a record is rolled back with the rest when the tree fails', async () => {
    const db = await freshDb();
    const orphan = { ...makeSet(0, 7), workout_exercise_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
    const record = {
      id: 'd0000000-0000-4000-8000-000000000002',
      user_id: USER_ID,
      exercise_id: ENTRIES[0].exercise_id as string,
      kind: 'e1rm' as const,
      reps: null,
      value_kg: 120,
      source_set_id: SETS[1].id,
      created_at: LATER,
      updated_at: LATER,
    };
    await expect(
      writeLocalTree(db, { workouts: [WORKOUT], workout_exercises: ENTRIES, sets: [...SETS, orphan], personal_records: [record] }),
    ).rejects.toThrow();
    expect(await getRowsByIds(db, 'personal_records', [record.id])).toEqual([]);
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

describe('deleteLocalRowsTx (B14)', () => {
  /** A device holding the fixture workout, already uploaded (outbox empty). */
  async function syncedDb() {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT]);
    await writeLocal(db, 'workout_exercises', ENTRIES);
    await writeLocal(db, 'sets', SETS);
    await db.runAsync('delete from outbox');
    return db;
  }

  it('deletes a set, queues one delete line, and re-stamps and queues its workout', async () => {
    const db = await syncedDb();
    await db.withTransactionAsync((tx) => deleteLocalRowsTx(tx, 'sets', [SETS[0].id], LATER));
    expect(await getRowsByIds(db, 'sets', [SETS[0].id])).toEqual([]);
    expect(await pendingRows(db, 'sets', 'delete')).toEqual([{ rowId: SETS[0].id, mark: expect.any(Number) }]);
    expect(await pendingRows(db, 'workouts')).toHaveLength(1);
    expect((await getRowsByIds(db, 'workouts', [WORKOUT.id]))[0].updated_at).toBe(LATER);
  });

  it('deleting an exercise slot takes its sets locally but queues only the slot', async () => {
    const db = await syncedDb();
    await db.withTransactionAsync((tx) => deleteLocalRowsTx(tx, 'workout_exercises', [ENTRIES[1].id], LATER));
    expect(await getRowsByIds(db, 'sets', [SETS[3].id, SETS[4].id])).toEqual([]);
    expect(await pendingRows(db, 'sets', 'delete')).toEqual([]);
    expect(await pendingRows(db, 'workout_exercises', 'delete')).toHaveLength(1);
  });

  it('deleting a workout queues just its delete and touches no other root', async () => {
    const db = await syncedDb();
    await db.withTransactionAsync((tx) => deleteLocalRowsTx(tx, 'workouts', [WORKOUT.id], LATER));
    expect(await outboxSize(db)).toBe(1);
    expect(await pendingRows(db, 'workouts', 'delete')).toHaveLength(1);
    expect(await db.getFirstAsync('select count(*) as n from sets')).toEqual({ n: 0 });
  });
});
