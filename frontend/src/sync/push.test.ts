/**
 * B07's definition of done, proven with a fake server and a real on-device
 * SQLite database: a workout logged offline lands on the server exactly once
 * after reconnecting, and a retried upload creates no duplicates.
 */
import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { writeLocal, type SetRow } from '@/db/dao';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { ENTRIES, makeSet, SETS, USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { SyncEngine } from './engine';
import { outboxSize } from './outbox';
import { PUSH_BATCH_SIZE, pushOutbox, withoutUpdatedAt } from './push';

const quiet = () => undefined;

/** A device with the fixture workout logged while offline. */
async function deviceWithOfflineWorkout() {
  const db = await prepareDatabase(createNodeSqliteDriver());
  const server = new FakeServer();
  server.offline = true; // airplane mode
  await writeLocal(db, 'workouts', [WORKOUT]);
  await writeLocal(db, 'workout_exercises', ENTRIES);
  await writeLocal(db, 'sets', SETS);
  const engine = new SyncEngine({ db, transport: server, userId: USER_ID, log: quiet });
  return { db, server, engine };
}

/** How many rows the server holds per table. */
function serverCounts(server: FakeServer) {
  return {
    workouts: server.tables.workouts.size,
    workout_exercises: server.tables.workout_exercises.size,
    sets: server.tables.sets.size,
  };
}

const ONE_WORKOUT = { workouts: 1, workout_exercises: 2, sets: 5 };

describe('offline workout → reconnect → server (step DoD)', () => {
  it('stays on the device while offline, then lands exactly once on reconnect', async () => {
    const { db, server, engine } = await deviceWithOfflineWorkout();

    const offline = await engine.syncNow();
    expect(offline.pushError).toBeDefined();
    expect(serverCounts(server)).toEqual({ workouts: 0, workout_exercises: 0, sets: 0 });
    expect(await outboxSize(db)).toBeGreaterThan(0);

    server.offline = false; // reconnect
    const online = await engine.syncNow();
    expect(online.pushError).toBeUndefined();
    expect(serverCounts(server)).toEqual(ONE_WORKOUT);
    expect(await outboxSize(db)).toBe(0);

    // Every value arrived intact (updated_at is the server's own stamp).
    const serverSet = server.tables.sets.get(SETS[1].id) as SetRow;
    expect(withoutUpdatedAt<'sets'>(serverSet)).toEqual(withoutUpdatedAt<'sets'>(SETS[1]));
    expect(server.tables.workouts.get(WORKOUT.id)?.created_at).toBe(WORKOUT.created_at);
  });

  it('a second sync, and a forced re-send of the same rows, change no counts', async () => {
    const { server, engine } = await deviceWithOfflineWorkout();
    server.offline = false;
    await engine.syncNow();
    await engine.syncNow();
    // Force the retry: send the exact same snapshot again.
    await server.upsert('workouts', [withoutUpdatedAt<'workouts'>(WORKOUT)]);
    await server.upsert('workout_exercises', ENTRIES.map((e) => withoutUpdatedAt<'workout_exercises'>(e)));
    await server.upsert('sets', SETS.map((s) => withoutUpdatedAt<'sets'>(s)));
    expect(serverCounts(server)).toEqual(ONE_WORKOUT);
  });

  it('a lost reply (saved on the server, reported as failed) is retried with no duplicate', async () => {
    const { db, server, engine } = await deviceWithOfflineWorkout();
    server.offline = false;
    server.loseNextResponse(); // the workouts batch is saved, but the phone hears "failed"

    const first = await engine.syncNow();
    expect(first.pushError).toBeDefined();
    expect(server.tables.workouts.size).toBe(1);
    expect(await outboxSize(db)).toBeGreaterThan(0); // nothing acknowledged

    await engine.syncNow();
    expect(serverCounts(server)).toEqual(ONE_WORKOUT);
    expect(await outboxSize(db)).toBe(0);
    // The workout really was sent more than once — and is still one row.
    expect(server.upsertCalls.filter((c) => c.tbl === 'workouts').length).toBeGreaterThanOrEqual(2);
  });

  it('a failure part-way (after workouts, before entries) retries to the same end state', async () => {
    const { db, server, engine } = await deviceWithOfflineWorkout();
    server.offline = false;
    server.failUpsertsOn('workout_exercises');

    await engine.syncNow();
    expect(serverCounts(server)).toEqual({ workouts: 1, workout_exercises: 0, sets: 0 });
    // Sets were never attempted: push stops at the first failure.
    expect(server.upsertCalls.some((c) => c.tbl === 'sets')).toBe(false);

    server.healUpserts();
    await engine.syncNow();
    expect(serverCounts(server)).toEqual(ONE_WORKOUT);
    expect(await outboxSize(db)).toBe(0);
  });
});

describe('pushOutbox', () => {
  it('sends parents before children and never sends updated_at', async () => {
    const { db, server } = await deviceWithOfflineWorkout();
    server.offline = false;
    // The fake server refuses orphans and any client updated_at, so success proves both.
    const result = await pushOutbox(db, server);
    // Workouts go twice: first as parents, then again to re-touch the root.
    expect(result.pushed).toEqual({ exercises: 0, workouts: 2, workout_exercises: 2, sets: 5 });
    expect(server.upsertCalls.map((c) => c.tbl)).toEqual(['workouts', 'workout_exercises', 'sets', 'workouts']);
    expect(await outboxSize(db)).toBe(0);
  });

  it("re-stamps the workout on the server after its contents land (touch-the-root)", async () => {
    const { db, server } = await deviceWithOfflineWorkout();
    server.offline = false;
    await pushOutbox(db, server);
    const workoutStamp = server.tables.workouts.get(WORKOUT.id)!.updated_at;
    const childStamps = [...server.tables.workout_exercises.values(), ...server.tables.sets.values()].map(
      (r) => r.updated_at,
    );
    expect(childStamps.every((s) => s < workoutStamp)).toBe(true);
  });

  it('re-touches the root even when the children land on a later retry', async () => {
    const { db, server } = await deviceWithOfflineWorkout();
    server.offline = false;
    server.failUpsertsOn('sets');
    await expect(pushOutbox(db, server)).rejects.toThrow();
    server.healUpserts();
    // Only the sets are still queued from the user's writes; the root comes back via the re-queue.
    await pushOutbox(db, server);
    const workoutStamp = server.tables.workouts.get(WORKOUT.id)!.updated_at;
    expect([...server.tables.sets.values()].every((s) => s.updated_at < workoutStamp)).toBe(true);
    expect(await outboxSize(db)).toBe(0);
  });

  it('keeps a re-queued root queued if the final workouts pass fails', async () => {
    const { db, server } = await deviceWithOfflineWorkout();
    server.offline = false;
    const realUpsert = server.upsert.bind(server);
    let workoutCalls = 0;
    server.upsert = async (tbl, rows) => {
      if (tbl === 'workouts' && ++workoutCalls === 2) throw new Error('dropped');
      return realUpsert(tbl, rows);
    };
    await expect(pushOutbox(db, server)).rejects.toThrow('dropped');
    expect((await db.getAllAsync<{ tbl: string }>('select distinct tbl from outbox')).map((r) => r.tbl)).toEqual([
      'workouts',
    ]);
  });

  it('coalesces repeated edits of one row into one upload of its latest state', async () => {
    const { db, server } = await deviceWithOfflineWorkout();
    server.offline = false;
    for (const reps of [6, 7, 8]) await writeLocal(db, 'sets', [{ ...SETS[0], reps }]);
    await pushOutbox(db, server);
    const setsCall = server.upsertCalls.find((c) => c.tbl === 'sets');
    expect(setsCall?.ids.filter((id) => id === SETS[0].id)).toHaveLength(1);
    expect(server.tables.sets.get(SETS[0].id)?.reps).toBe(8);
  });

  it(`uploads in batches of at most ${PUSH_BATCH_SIZE}`, async () => {
    const { db, server } = await deviceWithOfflineWorkout();
    server.offline = false;
    const many = Array.from({ length: 1100 }, (_, i) =>
      makeSet(0, 0, { id: `e0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, position: i }),
    );
    await writeLocal(db, 'sets', many);
    await pushOutbox(db, server);
    const setCalls = server.upsertCalls.filter((c) => c.tbl === 'sets');
    expect(setCalls.map((c) => c.ids.length)).toEqual([500, 500, 105]);
    expect(server.tables.sets.size).toBe(1105);
  });

  it('does nothing when the outbox is empty', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const server = new FakeServer();
    await pushOutbox(db, server);
    expect(server.upsertCalls).toEqual([]);
  });
});
