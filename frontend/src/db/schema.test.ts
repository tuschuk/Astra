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
      'personal_records',
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

  it('upgrades a version-2 phone to version 3 (sets.notes), keeping the sets already there', async () => {
    const db = createNodeSqliteDriver();
    // A phone that installed the app between B11 and B12: versions 1 and 2 have run.
    await db.execAsync(MIGRATIONS[0]);
    await db.execAsync(MIGRATIONS[1]);
    await db.execAsync('pragma user_version = 2');
    await db.runAsync(
      "insert into workouts (id, user_id, started_at, created_at, updated_at) values ('w', 'u', 't', 't', 't')",
    );
    await db.runAsync(
      "insert into workout_exercises (id, workout_id, position, created_at, updated_at) values ('e', 'w', 0, 't', 't')",
    );
    await db.runAsync(
      "insert into sets (id, workout_exercise_id, position, reps, score, created_at, updated_at) values ('s', 'e', 0, 5, 'AMRAP', 't', 't')",
    );

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select reps, score, notes from sets')).toEqual({ reps: 5, score: 'AMRAP', notes: null });
  });

  it('upgrades a version-3 phone through version 4 (personal_records), keeping the sets already there', async () => {
    const db = createNodeSqliteDriver();
    // A phone that installed the app between B12 and B13: versions 1–3 have run.
    for (const migration of MIGRATIONS.slice(0, 3)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 3');
    await db.runAsync(
      "insert into workouts (id, user_id, started_at, created_at, updated_at) values ('w', 'u', 't', 't', 't')",
    );
    await db.runAsync(
      "insert into workout_exercises (id, workout_id, position, created_at, updated_at) values ('e', 'w', 0, 't', 't')",
    );
    await db.runAsync(
      "insert into sets (id, workout_exercise_id, position, reps, notes, created_at, updated_at) values ('s', 'e', 0, 5, 'belt', 't', 't')",
    );

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select reps, notes from sets')).toEqual({ reps: 5, notes: 'belt' });
    expect(await db.getFirstAsync('select count(*) as n from personal_records')).toEqual({ n: 0 });
  });

  it('B14: upgrades a version-4 phone to version 5, keeping its waiting outbox lines as uploads', async () => {
    const db = createNodeSqliteDriver();
    // A phone that installed the app between B13 and B14, with two changes not yet uploaded.
    for (const migration of MIGRATIONS.slice(0, 4)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 4');
    await db.runAsync("insert into outbox (tbl, row_id, queued_at) values ('workouts', 'w', 't'), ('sets', 's', 't')");

    await migrate(db);

    expect(SCHEMA_VERSION).toBe(5);
    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: 5 });
    expect(await db.getAllAsync('select tbl, row_id, op from outbox order by id')).toEqual([
      { tbl: 'workouts', row_id: 'w', op: 'upsert' },
      { tbl: 'sets', row_id: 's', op: 'upsert' },
    ]);
  });

  it('upgrades a version-1 phone through every later version (sets.score), keeping the sets already there', async () => {
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

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
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
