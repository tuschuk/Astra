/**
 * Tests for the phone's flair list (B21), on real SQLite: read in picker order with yes/no as
 * true/false, replaced whole, and an empty server answer never wiping the copy.
 */
import { describe, expect, it } from '@jest/globals';

import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { prepareDatabase } from './database';
import type { FlairRow } from './dao';
import { readFlairs, replaceFlairsTx } from './flairs';

const SERVER_LIST: FlairRow[] = [
  { id: 'physique-check', name: 'Physique Check', position: 2, upvotes_only: true },
  { id: 'wod', name: 'WOD', position: 1, upvotes_only: false },
];

async function freshDb() {
  return prepareDatabase(createNodeSqliteDriver());
}

describe('flairs', () => {
  it('is empty before the first download', async () => {
    expect(await readFlairs(await freshDb())).toEqual([]);
  });

  it('saves the server’s list and reads it back in position order, upvotes_only as true/false', async () => {
    const db = await freshDb();
    expect(await db.withTransactionAsync((tx) => replaceFlairsTx(tx, SERVER_LIST))).toBe(2);
    expect(await readFlairs(db)).toEqual([SERVER_LIST[1], SERVER_LIST[0]]);
  });

  it('replaces the whole list: a flair dropped on the server is dropped here, a new one appears', async () => {
    const db = await freshDb();
    await db.withTransactionAsync((tx) => replaceFlairsTx(tx, SERVER_LIST));
    const next: FlairRow[] = [{ id: 'deadlift-day', name: 'Deadlift Day', position: 1, upvotes_only: false }];
    await db.withTransactionAsync((tx) => replaceFlairsTx(tx, next));
    expect(await readFlairs(db)).toEqual(next);
  });

  it('keeps the old list when the server answer is empty (stale chips beat none)', async () => {
    const db = await freshDb();
    await db.withTransactionAsync((tx) => replaceFlairsTx(tx, SERVER_LIST));
    expect(await db.withTransactionAsync((tx) => replaceFlairsTx(tx, []))).toBe(0);
    expect(await readFlairs(db)).toHaveLength(2);
  });
});
