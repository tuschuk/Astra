/**
 * B07's definition of done, proven with a fake server and a real on-device
 * SQLite database: a workout logged offline lands on the server exactly once
 * after reconnecting, and a retried upload creates no duplicates. Plus the
 * deletes phase (B14) and the settings phase (B15).
 */
import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { deleteLocalRowsTx, writeLocal, type SetRow } from '@/db/dao';
import { createUnitStore } from '@/settings/unitStore';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { ENTRIES, makeSet, SETS, USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { SyncEngine } from './engine';
import { enqueueTx, outboxSize } from './outbox';
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
    expect(result.pushed).toEqual({ exercises: 0, workouts: 2, workout_exercises: 2, sets: 5, personal_records: 0 });
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

describe('pushOutbox — the delete phase (B14)', () => {
  /** Wraps the fake server so every request lands in one ordered log. */
  function recorded(server: FakeServer) {
    const log: string[] = [];
    const transport = Object.create(server) as FakeServer;
    transport.upsert = async (tbl, rows) => {
      log.push(`upsert ${tbl}`);
      return server.upsert(tbl, rows);
    };
    transport.deleteRows = async (tbl, ids) => {
      log.push(`delete ${tbl}`);
      return server.deleteRows(tbl, ids);
    };
    return { transport, log };
  }

  it('sends every delete before any upload and clears only the delete lines', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const server = new FakeServer();
    await writeLocal(db, 'workouts', [WORKOUT]);
    await writeLocal(db, 'workout_exercises', ENTRIES);
    await writeLocal(db, 'sets', SETS);
    await pushOutbox(db, server);

    // Remove one set (a synced delete), then edit another.
    await db.withTransactionAsync((tx) => deleteLocalRowsTx(tx, 'sets', [SETS[4].id], '2026-11-15T00:00:00.000Z'));
    await writeLocal(db, 'sets', [{ ...SETS[3], reps: 8 }]);
    const { transport, log } = recorded(server);
    const result = await pushOutbox(db, transport);

    expect(log[0]).toBe('delete sets');
    expect(log.filter((l) => l.startsWith('delete'))).toEqual(['delete sets']);
    expect(result.deleted.sets).toBe(1);
    expect(server.tables.sets.has(SETS[4].id)).toBe(false);
    expect(server.tables.sets.get(SETS[3].id)?.reps).toBe(8);
    expect(await outboxSize(db)).toBe(0);
  });

  it('a failed delete stops the push before any upload, and keeps everything queued', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const server = new FakeServer();
    await writeLocal(db, 'workouts', [WORKOUT]);
    await writeLocal(db, 'workout_exercises', ENTRIES);
    await pushOutbox(db, server);
    await db.withTransactionAsync((tx) =>
      deleteLocalRowsTx(tx, 'workout_exercises', [ENTRIES[1].id], '2026-11-15T00:00:00.000Z'),
    );
    server.failUpsertsOn('workout_exercises'); // the fake refuses deletes from that table too
    const uploadsBefore = server.upsertCalls.length;
    await expect(pushOutbox(db, server)).rejects.toThrow(/refused/);
    expect(server.upsertCalls.length).toBe(uploadsBefore);
    expect(await outboxSize(db)).toBeGreaterThan(0);

    server.healUpserts();
    await pushOutbox(db, server);
    expect(server.tables.workout_exercises.has(ENTRIES[1].id)).toBe(false);
    expect(await outboxSize(db)).toBe(0);
  });
});

describe('B15: the settings phase', () => {
  /** A device and server where the user's settings row exists (the signup trigger's doing). */
  async function deviceWithAccount() {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const server = new FakeServer();
    server.seedUserSettings(USER_ID, 'lb');
    return { db, server, store: createUnitStore() };
  }

  it('a toggle made offline reaches the server exactly once after reconnecting', async () => {
    const { db, server, store } = await deviceWithAccount();
    server.offline = true;
    await store.setUnit(db, USER_ID, 'kg');
    await expect(pushOutbox(db, server)).rejects.toThrow('Network request failed');
    expect(server.userSettings.get(USER_ID)?.unit).toBe('lb');
    expect(await outboxSize(db)).toBe(1);

    server.offline = false;
    const result = await pushOutbox(db, server);
    expect(result.userSettings).toBe(1);
    expect(server.userSettings.get(USER_ID)?.unit).toBe('kg');
    expect(await outboxSize(db)).toBe(0);
    // Exactly one successful upload (the offline attempt is recorded, then refused).
    expect(server.userSettingsPushes).toEqual([
      { userId: USER_ID, unit: 'kg' },
      { userId: USER_ID, unit: 'kg' },
    ]);
    expect((await pushOutbox(db, server)).userSettings).toBe(0);
  });

  it('sends the latest choice once, however many times it was flipped', async () => {
    const { db, server, store } = await deviceWithAccount();
    await store.setUnit(db, USER_ID, 'kg');
    await store.setUnit(db, USER_ID, 'lb');
    await store.setUnit(db, USER_ID, 'kg');
    expect((await pushOutbox(db, server)).userSettings).toBe(1);
    expect(server.userSettingsPushes).toEqual([{ userId: USER_ID, unit: 'kg' }]);
  });

  it('a toggle flipped while the upload is in flight is sent next time, not lost', async () => {
    const { db, server, store } = await deviceWithAccount();
    await store.setUnit(db, USER_ID, 'kg');
    const realPush = server.pushUserSettings.bind(server);
    server.pushUserSettings = async (userId, unit) => {
      await store.setUnit(db, USER_ID, 'lb'); // flipped back mid-upload
      return realPush(userId, unit);
    };
    await pushOutbox(db, server);
    expect(server.userSettings.get(USER_ID)?.unit).toBe('kg');
    expect(await outboxSize(db)).toBe(1); // the mid-flight flip survived the acknowledgement

    server.pushUserSettings = realPush;
    await pushOutbox(db, server);
    expect(server.userSettings.get(USER_ID)?.unit).toBe('lb');
    expect(await outboxSize(db)).toBe(0);
  });

  it('a leftover line whose row the server won’t match changes nothing there and is cleared (no wedge)', async () => {
    const { db, server, store } = await deviceWithAccount();
    // A previous account's choice, on a server where that account has no row visible.
    await store.setUnit(db, 'previous-account', 'kg');
    const result = await pushOutbox(db, server);
    expect(result.userSettings).toBe(1);
    expect(server.userSettings.has('previous-account')).toBe(false);
    expect(server.userSettings.get(USER_ID)?.unit).toBe('lb');
    expect(await outboxSize(db)).toBe(0);
  });

  it('a waiting line whose local row is gone uploads nothing and is cleared', async () => {
    const { db, server } = await deviceWithAccount();
    await db.withTransactionAsync((tx) => enqueueTx(tx, 'user_settings', USER_ID, '2026-11-15T00:00:00.000Z'));
    expect((await pushOutbox(db, server)).userSettings).toBe(0);
    expect(server.userSettingsPushes).toEqual([]);
    expect(await outboxSize(db)).toBe(0);
  });
});
