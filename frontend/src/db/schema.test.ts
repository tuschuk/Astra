/**
 * Tests for the device schema and its upgrade routine, on real SQLite.
 */
import { describe, expect, it } from '@jest/globals';

import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { TABLE_COLUMNS } from './dao';
import { migrate, SCHEMA_VERSION } from './schema';

describe('migrate', () => {
  it('creates every table and records the schema version', async () => {
    const db = createNodeSqliteDriver();
    await migrate(db);
    const tables = await db.getAllAsync<{ name: string }>(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
    );
    expect(tables.map((t) => t.name)).toEqual([
      'exercises',
      'outbox',
      'sets',
      'sync_state',
      'workout_exercises',
      'workouts',
    ]);
    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
  });

  it('is a no-op on an already-current database', async () => {
    const db = createNodeSqliteDriver();
    await migrate(db);
    await db.runAsync("insert into sync_state (key, value) values ('k', 'v')");
    await migrate(db);
    expect(await db.getFirstAsync('select value from sync_state')).toEqual({ value: 'v' });
  });

  it('gives each mirrored table exactly the columns the sync code sends and reads', async () => {
    const db = createNodeSqliteDriver();
    await migrate(db);
    for (const [tbl, columns] of Object.entries(TABLE_COLUMNS)) {
      const info = await db.getAllAsync<{ name: string }>(`pragma table_info(${tbl})`);
      expect(info.map((c) => c.name).sort()).toEqual([...columns].sort());
    }
  });
});
