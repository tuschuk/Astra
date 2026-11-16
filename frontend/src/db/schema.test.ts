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
      'flairs',
      'outbox',
      'personal_records',
      'posts',
      'program_exercises',
      'program_runs',
      'program_weeks',
      'program_workouts',
      'programs',
      'sets',
      'sync_state',
      'user_settings',
      'workout_analyses',
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

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getAllAsync('select tbl, row_id, op from outbox order by id')).toEqual([
      { tbl: 'workouts', row_id: 'w', op: 'upsert' },
      { tbl: 'sets', row_id: 's', op: 'upsert' },
    ]);
  });

  it('B15: upgrades a version-5 phone to version 6 (user_settings), keeping its workouts and outbox', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 5)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 5');
    await db.runAsync(
      "insert into workouts (id, user_id, started_at, created_at, updated_at) values ('w', 'u', 't', 't', 't')",
    );
    await db.runAsync("insert into outbox (tbl, row_id, queued_at) values ('workouts', 'w', 't')");

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 1 });
    expect(await db.getFirstAsync('select count(*) as n from outbox')).toEqual({ n: 1 });
    const columns = await db.getAllAsync<{ name: string }>('pragma table_info(user_settings)');
    expect(columns.map((c) => c.name)).toEqual(['user_id', 'unit', 'updated_at', 'progress_pic_visibility']);
  });

  it('B18: upgrades a version-6 phone to version 7 (workout_analyses), keeping its workouts and outbox', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 6)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 6');
    await db.runAsync(
      "insert into workouts (id, user_id, started_at, created_at, updated_at) values ('w', 'u', 't', 't', 't')",
    );
    await db.runAsync("insert into outbox (tbl, row_id, queued_at) values ('workouts', 'w', 't')");

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 1 });
    expect(await db.getFirstAsync('select count(*) as n from outbox')).toEqual({ n: 1 });
    expect(await db.getFirstAsync('select count(*) as n from workout_analyses')).toEqual({ n: 0 });
  });

  it('B21: upgrades a version-7 phone to version 8 (flairs, posts), keeping its workouts and outbox', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 7)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 7');
    await db.runAsync(
      "insert into workouts (id, user_id, started_at, ended_at, created_at, updated_at) values ('w', 'u', 't', 't', 't', 't')",
    );
    await db.runAsync("insert into outbox (tbl, row_id, queued_at) values ('workouts', 'w', 't')");

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 1 });
    expect(await db.getFirstAsync('select count(*) as n from outbox')).toEqual({ n: 1 });
    expect(await db.getFirstAsync('select count(*) as n from flairs')).toEqual({ n: 0 });
    // One post per workout, on the phone as on the server.
    const insertPost = "insert into posts (id, user_id, flair_id, workout_id, visibility, created_at, updated_at) values (?, 'u', 'wod', 'w', 'public', 't', 't')";
    await db.runAsync(insertPost, ['p1']);
    await expect(db.runAsync(insertPost, ['p2'])).rejects.toThrow(/UNIQUE/);
  });

  it('B22: upgrades a version-8 phone to version 9, keeping its posts as workout posts and letting photo posts in', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 8)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 8');
    await db.runAsync(
      "insert into posts (id, user_id, flair_id, workout_id, visibility, created_at, updated_at) values ('p1', 'u', 'wod', 'w', 'public', 't1', 't2')",
    );
    await db.runAsync("insert into outbox (tbl, row_id, queued_at) values ('posts', 'p1', 't')");

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getAllAsync('select * from posts')).toEqual([
      {
        id: 'p1',
        user_id: 'u',
        flair_id: 'wod',
        kind: 'workout',
        workout_id: 'w',
        image_path: null,
        visibility: 'public',
        created_at: 't1',
        updated_at: 't2',
      },
    ]);
    expect(await db.getFirstAsync('select count(*) as n from outbox')).toEqual({ n: 1 });
    // Photo posts have no workout — any number of them fit beside the unique rule…
    const insertPhoto =
      "insert into posts (id, user_id, flair_id, kind, image_path, visibility, created_at, updated_at) values (?, 'u', 'new-pr', 'pr', ?, 'public', 't', 't')";
    await db.runAsync(insertPhoto, ['p2', 'u/p2.jpg']);
    await db.runAsync(insertPhoto, ['p3', 'u/p3.jpg']);
    // …while one post per workout still holds.
    await expect(
      db.runAsync(
        "insert into posts (id, user_id, flair_id, workout_id, visibility, created_at, updated_at) values ('p4', 'u', 'wod', 'w', 'public', 't', 't')",
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('B26: upgrades a version-9 phone to version 10, keeping its unit and making new progress pics private', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 9)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 9');
    await db.runAsync("insert into user_settings (user_id, unit, updated_at) values ('u', 'kg', 't')");
    await db.runAsync("insert into outbox (tbl, row_id, queued_at) values ('user_settings', 'u', 't')");

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select * from user_settings')).toEqual({
      user_id: 'u',
      unit: 'kg',
      updated_at: 't',
      progress_pic_visibility: 'private',
    });
    expect(await db.getFirstAsync('select count(*) as n from outbox')).toEqual({ n: 1 });
  });

  it('B31: upgrades a version-10 phone to version 11, leaving every exercise live', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 10)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 10');
    await db.runAsync(
      "insert into exercises (id, owner_id, name, created_at, updated_at) values ('x', 'u', 'My Curl', 't', 't')",
    );

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select name, deleted_at from exercises')).toEqual({ name: 'My Curl', deleted_at: null });
  });

  it('B34: upgrades a version-11 phone to version 12 with the four empty program tables', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 11)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 11');
    await db.runAsync("insert into workouts (id, user_id, started_at, created_at, updated_at) values ('w', 'u', 't', 't', 't')");

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 1 });
    for (const tbl of ['programs', 'program_weeks', 'program_workouts', 'program_exercises'] as const) {
      expect(await db.getFirstAsync(`select count(*) as n from ${tbl}`)).toEqual({ n: 0 });
      const columns = await db.getAllAsync<{ name: string }>(`pragma table_info(${tbl})`);
      expect(columns.map((c) => c.name).sort()).toEqual([...TABLE_COLUMNS[tbl]].sort());
    }
  });

  it('B35: upgrades a version-12 phone to version 13 — an empty program_runs table and an unlinked workouts column', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 12)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 12');
    await db.runAsync("insert into workouts (id, user_id, started_at, created_at, updated_at) values ('w', 'u', 't', 't', 't')");

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select id, program_workout_id from workouts')).toEqual({ id: 'w', program_workout_id: null });
    expect(await db.getFirstAsync('select count(*) as n from program_runs')).toEqual({ n: 0 });
    const columns = await db.getAllAsync<{ name: string }>('pragma table_info(program_runs)');
    expect(columns.map((c) => c.name).sort()).toEqual([...TABLE_COLUMNS.program_runs].sort());
  });

  it('B39: upgrades a version-13 phone to version 14 — its programs gain visibility, all private', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 13)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 13');
    await db.runAsync(
      "insert into programs (id, user_id, name, created_at, updated_at) values ('p', 'u', 'Block', 't', 't')",
    );

    await migrate(db);

    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: SCHEMA_VERSION });
    expect(await db.getFirstAsync('select id, name, visibility from programs')).toEqual({ id: 'p', name: 'Block', visibility: 'private' });
    const columns = await db.getAllAsync<{ name: string }>('pragma table_info(programs)');
    expect(columns.map((c) => c.name).sort()).toEqual([...TABLE_COLUMNS.programs].sort());
  });

  it('B42: upgrades a version-14 phone to version 15 — existing analyses stay readable with null trend columns', async () => {
    const db = createNodeSqliteDriver();
    for (const migration of MIGRATIONS.slice(0, 14)) await db.execAsync(migration);
    await db.execAsync('pragma user_version = 14');
    await db.runAsync(
      `insert into workout_analyses (id, user_id, engine_version, total_volume_kg, total_sets, working_sets,
         duration_seconds, new_prs, headline, message, workout_updated_at, created_at, updated_at)
       values ('w', 'u', 1, 500, 3, 3, 600, '[]', 'Solid session', 'm', 't', 't', 't')`,
    );

    await migrate(db);

    expect(SCHEMA_VERSION).toBe(15);
    expect(await db.getFirstAsync('pragma user_version')).toEqual({ user_version: 15 });
    expect(
      await db.getFirstAsync(
        `select engine_version, total_volume_kg, trend_sessions, trend_volume_avg_kg, trend_rpe_avg,
           trend_load_per_rep_avg_kg, session_rpe_avg, session_load_per_rep_kg from workout_analyses`,
      ),
    ).toEqual({
      engine_version: 1,
      total_volume_kg: 500,
      trend_sessions: null,
      trend_volume_avg_kg: null,
      trend_rpe_avg: null,
      trend_load_per_rep_avg_kg: null,
      session_rpe_avg: null,
      session_load_per_rep_kg: null,
    });
    const columns = await db.getAllAsync<{ name: string }>('pragma table_info(workout_analyses)');
    expect(columns.map((c) => c.name).sort()).toEqual([...TABLE_COLUMNS.workout_analyses].sort());
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
