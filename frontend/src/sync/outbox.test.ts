/**
 * Tests for the outbox's watermark acknowledgement — the piece that keeps an
 * edit made during an upload from being lost.
 */
import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { writeLocal } from '@/db/dao';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { WORKOUT } from '@/test-utils/workoutFixtures';

import { acknowledge, dropLinesTx, enqueueTx, outboxSize, pendingRows, rowsWithPendingChanges } from './outbox';

describe('outbox ops (B14)', () => {
  it('lists and acknowledges deletes and uploads separately, each with its own watermark', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    // A demotion: "delete record R" (line 1), then "upload record R" (line 2).
    await db.withTransactionAsync(async (tx) => {
      await enqueueTx(tx, 'personal_records', 'r', 't', 'delete');
      await enqueueTx(tx, 'personal_records', 'r', 't');
    });
    const deletes = await pendingRows(db, 'personal_records', 'delete');
    expect(deletes).toEqual([{ rowId: 'r', mark: 1 }]);
    expect(await pendingRows(db, 'personal_records')).toEqual([{ rowId: 'r', mark: 2 }]);

    // Acknowledging the delete must not swallow the re-insert queued after it.
    await acknowledge(db, 'personal_records', deletes, [], 'delete');
    expect(await pendingRows(db, 'personal_records', 'delete')).toEqual([]);
    expect(await pendingRows(db, 'personal_records')).toEqual([{ rowId: 'r', mark: 2 }]);
    expect(await outboxSize(db)).toBe(1);
  });

  it('an upload acknowledgement leaves a later delete of the same row queued', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await writeLocal(db, 'workouts', [WORKOUT]);
    const uploads = await pendingRows(db, 'workouts');
    await db.withTransactionAsync((tx) => enqueueTx(tx, 'workouts', WORKOUT.id, 't', 'delete'));
    await acknowledge(db, 'workouts', uploads);
    expect(await pendingRows(db, 'workouts', 'delete')).toHaveLength(1);
    expect(await rowsWithPendingChanges(db, 'workouts', [WORKOUT.id])).toEqual(new Set([WORKOUT.id]));
  });

  it('dropLinesTx throws away every line of the given rows, of both ops', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync(async (tx) => {
      await enqueueTx(tx, 'sets', 'a', 't');
      await enqueueTx(tx, 'sets', 'a', 't', 'delete');
      await enqueueTx(tx, 'sets', 'b', 't');
      await dropLinesTx(tx, 'sets', ['a']);
    });
    expect(await rowsWithPendingChanges(db, 'sets', ['a', 'b'])).toEqual(new Set(['b']));
  });
});

describe('outbox', () => {
  it('lists each changed row once, however many times it was edited', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    for (let i = 0; i < 3; i++) await writeLocal(db, 'workouts', [{ ...WORKOUT, title: `v${i}` }]);
    expect(await outboxSize(db)).toBe(3);
    const pending = await pendingRows(db, 'workouts');
    expect(pending).toHaveLength(1);
    expect(pending[0].mark).toBe(3);
  });

  it('keeps an edit that landed after the upload read its watermark', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await writeLocal(db, 'workouts', [WORKOUT]);
    const snapshot = await pendingRows(db, 'workouts');
    // The user edits again while the upload is in flight…
    await writeLocal(db, 'workouts', [{ ...WORKOUT, title: 'edited mid-flight' }]);
    // …then the server accepts the first upload.
    await acknowledge(db, 'workouts', snapshot);
    expect(await pendingRows(db, 'workouts')).toHaveLength(1);
  });

  it('clears a row completely once its latest line is acknowledged', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await writeLocal(db, 'workouts', [WORKOUT]);
    await writeLocal(db, 'workouts', [WORKOUT]);
    await acknowledge(db, 'workouts', await pendingRows(db, 'workouts'));
    expect(await outboxSize(db)).toBe(0);
  });

  it('reports which rows have unsent changes', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await writeLocal(db, 'workouts', [WORKOUT]);
    expect(await rowsWithPendingChanges(db, 'workouts', [WORKOUT.id, 'other'])).toEqual(new Set([WORKOUT.id]));
    expect(await rowsWithPendingChanges(db, 'sets', [WORKOUT.id])).toEqual(new Set());
    expect(await rowsWithPendingChanges(db, 'workouts', [])).toEqual(new Set());
  });
});
