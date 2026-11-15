/**
 * Tests for the serialising driver: transactions commit or roll back as a
 * whole, and nothing else can run in the middle of one.
 */
import { describe, expect, it } from '@jest/globals';

import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { createSerializedDriver } from './driver';

describe('createSerializedDriver (over node:sqlite)', () => {
  it('commits a successful transaction and returns its value', async () => {
    const db = createNodeSqliteDriver();
    await db.execAsync('create table t (v text)');
    const value = await db.withTransactionAsync(async (tx) => {
      await tx.runAsync('insert into t values (?)', ['a']);
      return 42;
    });
    expect(value).toBe(42);
    expect(await db.getAllAsync('select v from t')).toEqual([{ v: 'a' }]);
  });

  it('rolls back everything when the transaction throws, and keeps working after', async () => {
    const db = createNodeSqliteDriver();
    await db.execAsync('create table t (v text)');
    await expect(
      db.withTransactionAsync(async (tx) => {
        await tx.runAsync('insert into t values (?)', ['a']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.getAllAsync('select v from t')).toEqual([]);
    await db.runAsync('insert into t values (?)', ['b']);
    expect(await db.getFirstAsync('select v from t')).toEqual({ v: 'b' });
  });

  it('queues an outside read until a running transaction has finished', async () => {
    const db = createNodeSqliteDriver();
    await db.execAsync('create table t (v text)');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const txn = db.withTransactionAsync(async (tx) => {
      await tx.runAsync('insert into t values (?)', ['half']);
      await gate;
      throw new Error('abandon');
    });
    // Issued while the transaction is open with an uncommitted row.
    const read = db.getAllAsync('select v from t');
    release();
    await expect(txn).rejects.toThrow('abandon');
    // The read never saw the rolled-back row.
    expect(await read).toEqual([]);
  });

  it('reports how many rows a statement changed and returns null for no row', async () => {
    const db = createNodeSqliteDriver();
    await db.execAsync('create table t (v text)');
    expect((await db.runAsync('insert into t values (?), (?)', ['a', 'b'])).changes).toBe(2);
    expect(await db.getFirstAsync('select v from t where v = ?', ['zzz'])).toBeNull();
  });
});

describe('createSerializedDriver closeAsync (B32)', () => {
  it('closes only after everything already queued has run', async () => {
    const log: string[] = [];
    const raw = {
      execAsync: async (sql: string) => {
        await new Promise((r) => setTimeout(r, 5));
        log.push(sql);
      },
      runAsync: async () => ({ changes: 0 }),
      getAllAsync: async <T,>() => [] as T[],
      getFirstAsync: async () => null,
    };
    const db = createSerializedDriver(raw, async () => {
      log.push('close');
    });
    const work = [db.execAsync('one'), db.execAsync('two')];
    await db.closeAsync?.();
    await Promise.all(work);
    expect(log).toEqual(['one', 'two', 'close']);
  });

  it('has a harmless close when the engine gave none', async () => {
    const db = createSerializedDriver({
      execAsync: async () => undefined,
      runAsync: async () => ({ changes: 0 }),
      getAllAsync: async <T,>() => [] as T[],
      getFirstAsync: async () => null,
    });
    await expect(db.closeAsync?.()).resolves.toBeUndefined();
  });
});
