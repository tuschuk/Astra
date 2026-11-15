/**
 * Tests for the unit store (B15), on real SQLite: loading the lifter's unit, the toggle's
 * one-transaction write (row + one outbox line), telling subscribers, the account-switch guard,
 * and that no stored weight is ever touched.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { onLocalWrite, writeLocal } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { readUserSettingsRow, writeUserSettingsRowTx } from '@/db/userSettings';
import { pendingRows } from '@/sync/outbox';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { ENTRIES, SETS, WORKOUT } from '@/test-utils/workoutFixtures';

import { createUnitStore, DEFAULT_DISPLAY_UNIT } from './unitStore';

function freshDb(): Promise<SqlDriver> {
  return prepareDatabase(createNodeSqliteDriver());
}

/** Lets pending promise callbacks (a re-read after a download) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('unit store', () => {
  it('shows pounds before anything is loaded, and when the lifter has no row yet', async () => {
    const store = createUnitStore();
    expect(store.getSnapshot()).toBe('lb');
    expect(DEFAULT_DISPLAY_UNIT).toBe('lb');
    await store.hydrate(await freshDb(), 'u1');
    expect(store.getSnapshot()).toBe('lb');
  });

  it('loads the lifter’s saved unit and tells subscribers', async () => {
    const db = await freshDb();
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, { user_id: 'u1', unit: 'kg', updated_at: 't' }));
    const store = createUnitStore();
    const listener = jest.fn();
    store.subscribe(listener);
    await store.hydrate(db, 'u1');
    expect(store.getSnapshot()).toBe('kg');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hydrating a different user replaces the unit wholesale', async () => {
    const db = await freshDb();
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, { user_id: 'u1', unit: 'kg', updated_at: 't' }));
    const store = createUnitStore();
    await store.hydrate(db, 'u1');
    await store.hydrate(db, 'u2');
    expect(store.getSnapshot()).toBe('lb');
  });

  it('setUnit saves the row and exactly one upload line in one go, then wakes the sync engine', async () => {
    const db = await freshDb();
    const store = createUnitStore();
    await store.hydrate(db, 'u1');
    const heard: string[] = [];
    const unsubscribe = onLocalWrite(db, (tbl) => heard.push(tbl));
    const listener = jest.fn();
    store.subscribe(listener);

    await store.setUnit(db, 'u1', 'kg', { now: '2026-11-15T01:00:00.000Z' });

    expect(store.getSnapshot()).toBe('kg');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await readUserSettingsRow(db, 'u1')).toEqual({
      user_id: 'u1',
      unit: 'kg',
      updated_at: '2026-11-15T01:00:00.000Z',
    });
    const pending = await pendingRows(db, 'user_settings');
    expect(pending.map((p) => p.rowId)).toEqual(['u1']);
    expect(heard).toEqual(['user_settings']);
    unsubscribe();
  });

  it('a failed save changes nothing on screen and queues nothing', async () => {
    const db = await freshDb();
    const store = createUnitStore();
    await store.hydrate(db, 'u1');
    await db.execAsync('drop table user_settings'); // make the write fail
    await expect(store.setUnit(db, 'u1', 'kg')).rejects.toThrow();
    expect(store.getSnapshot()).toBe('lb');
    expect(await pendingRows(db, 'user_settings')).toEqual([]);
  });

  it('a toggle made while the sign-in load is still reading wins over that load', async () => {
    const db = await freshDb();
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, { user_id: 'u1', unit: 'lb', updated_at: 't' }));
    const store = createUnitStore();
    const loading = store.hydrate(db, 'u1');
    await store.setUnit(db, 'u1', 'kg');
    await loading;
    expect(store.getSnapshot()).toBe('kg');
  });

  it('a downloaded row updates subscribers from the phone’s row', async () => {
    const db = await freshDb();
    const store = createUnitStore();
    await store.hydrate(db, 'u1');
    const listener = jest.fn();
    store.subscribe(listener);
    // What the pull does: save the server's row, then hand it over.
    const row = { user_id: 'u1', unit: 'kg' as const, updated_at: '2026-11-15T02:00:00+00:00' };
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, row));
    store.applyPulled(row);
    await settle();
    expect(store.getSnapshot()).toBe('kg');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a downloaded row that belongs to another user (an account switch mid-sync)', async () => {
    const db = await freshDb();
    const store = createUnitStore();
    await store.hydrate(db, 'new-user');
    const old = { user_id: 'old-user', unit: 'kg' as const, updated_at: 't' };
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, old));
    store.applyPulled(old);
    await settle();
    expect(store.getSnapshot()).toBe('lb');
  });

  it('switching units never touches a stored weight', async () => {
    const db = await freshDb();
    await writeLocal(db, 'workouts', [WORKOUT]);
    await writeLocal(db, 'workout_exercises', ENTRIES);
    await writeLocal(db, 'sets', SETS);
    const before = await db.getAllAsync('select id, weight_kg, updated_at from sets order by id');
    const store = createUnitStore();
    await store.hydrate(db, 'u1');
    await store.setUnit(db, 'u1', 'kg');
    await store.setUnit(db, 'u1', 'lb');
    expect(await db.getAllAsync('select id, weight_kg, updated_at from sets order by id')).toEqual(before);
  });

  it('a failed load is retried on the next call instead of being reused', async () => {
    const db = await freshDb();
    const store = createUnitStore();
    const realGet = db.getFirstAsync.bind(db);
    db.getFirstAsync = (async () => {
      throw new Error('disk busy');
    }) as typeof db.getFirstAsync;
    await expect(store.hydrate(db, 'u1')).rejects.toThrow('disk busy');
    db.getFirstAsync = realGet;
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, { user_id: 'u1', unit: 'kg', updated_at: 't' }));
    await store.hydrate(db, 'u1');
    expect(store.getSnapshot()).toBe('kg');
  });

  it('reset goes back to pounds and forgets the user', async () => {
    const db = await freshDb();
    const store = createUnitStore();
    await store.setUnit(db, 'u1', 'kg');
    store.reset();
    expect(store.getSnapshot()).toBe('lb');
    store.applyPulled({ user_id: 'u1', unit: 'kg', updated_at: 't' });
    await settle();
    expect(store.getSnapshot()).toBe('lb');
  });
});
