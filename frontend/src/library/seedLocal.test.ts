/**
 * Tests for the first-launch library seed on the device.
 */
import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { upsertRows } from '@/db/dao';
import { outboxSize } from '@/sync/outbox';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { ALL_EXERCISES } from './catalog';
import { SEED_TIMESTAMP, seedLocalLibrary } from './seedLocal';
import { libraryExerciseId } from './uuidv5';

describe('seedLocalLibrary', () => {
  it('puts every catalog exercise on the device under its server id, without queueing uploads', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const rows = await db.getAllAsync<{ id: string; slug: string; owner_id: string | null }>(
      'select id, slug, owner_id from exercises',
    );
    expect(rows).toHaveLength(ALL_EXERCISES.length);
    for (const row of rows) {
      expect(row.id).toBe(libraryExerciseId(row.slug));
      expect(row.owner_id).toBeNull();
    }
    expect(await db.getFirstAsync('select name, primary_muscle, equipment from exercises where slug = ?', ['bench_press']))
      .toEqual({ name: 'Bench Press', primary_muscle: 'Chest', equipment: 'Barbell' });
    expect(await outboxSize(db)).toBe(0);
  });

  it('adds nothing on a second launch', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    expect(await seedLocalLibrary(db)).toBe(0);
  });

  it('never overwrites a fresher copy downloaded from the server', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const id = libraryExerciseId('bench_press');
    await upsertRows(db, 'exercises', [
      {
        id,
        owner_id: null,
        name: 'Barbell Bench Press',
        primary_muscle: 'Chest',
        equipment: 'Barbell',
        slug: 'bench_press',
        created_at: '2026-11-14T12:00:00.000Z',
        updated_at: '2026-11-14T12:00:00.000Z',
      },
    ]);
    await seedLocalLibrary(db);
    expect(await db.getFirstAsync('select name from exercises where id = ?', [id])).toEqual({
      name: 'Barbell Bench Press',
    });
  });

  it('re-adds a catalog exercise missing from the device and stamps it with the seed epoch', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.runAsync('delete from exercises where slug = ?', ['squat']);
    expect(await seedLocalLibrary(db)).toBe(1);
    expect(await db.getFirstAsync('select updated_at from exercises where slug = ?', ['squat'])).toEqual({
      updated_at: SEED_TIMESTAMP,
    });
  });
});
