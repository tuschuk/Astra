/**
 * Tests for the device schema and its upgrade routine, on real SQLite.
 */
import { describe, expect, it } from '@jest/globals';

import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { TABLE_COLUMNS } from './dao';
import { MIGRATIONS, migrate, SCHEMA_VERSION } from './schema';

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

  it('upgrades a version-1 phone to version 2 (sets.score), keeping the sets already there', async () => {
    const db = createNodeSqliteDriver();
    // A phone that installed the app before B11: only version 1 has run.
    await db.execAsync(MIGRATIONS[0]);
    await db.execAsync('pragma user_version = 1');
    await db.runAsync(
      "insert into workouts (id, user_id, started_at, created_at, updated_at) values ('w', 'u', 't', 't', 't')",
    );
    await db.runAsync(
      "insert into workout_exercises (id, workout_id, position, created_at, updated_at) values ('e', 'w', 0, 't', 't')",
    );
    await db.runAsync(
      "insert into sets (id, workout_exercise_id, position, reps, created_at, updated_at) values ('s', 'e', 0, 5, 't', 't')",
    );

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: 2 });
    expect(await db.getFirstAsync('select reps, score from sets')).toEqual({ reps: 5, score: null });
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
