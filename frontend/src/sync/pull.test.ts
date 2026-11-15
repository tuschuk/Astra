/**
 * Tests for the download half of sync: bookmarks, paging, the
 * never-overwrite-an-unsent-edit rule, and the overlap margin.
 */
import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { getRowsByIds, writeLocal, type PersonalRecordRow, type WorkoutRow } from '@/db/dao';
import { readFlairs } from '@/db/flairs';
import { readUserSettingsRow, type UserSettingsRow } from '@/db/userSettings';
import { createWorkoutPost } from '@/social/createPost';
import { libraryExerciseId } from '@/library/uuidv5';
import { createUnitStore } from '@/settings/unitStore';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { ENTRIES, OTHER_USER_ID, SETS, USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { pushOutbox } from './push';
import {
  CHILD_CHUNK_SIZE,
  CURSOR_KEYS,
  PULL_OVERLAP_MS,
  PULL_PAGE_SIZE,
  pullChanges,
  readCursor,
  rewind,
  TOMBSTONE_CURSOR_KEY,
} from './pull';

const strip = <T extends { updated_at: string }>(row: T): Omit<T, 'updated_at'> => {
  const { updated_at: _ignored, ...rest } = row;
  return rest;
};

function workoutN(i: number, userId = USER_ID): Omit<WorkoutRow, 'updated_at'> {
  return strip({ ...WORKOUT, id: `a1000000-0000-4000-8000-${String(i).padStart(12, '0')}`, user_id: userId, title: `W${i}` });
}

async function setup() {
  const db = await prepareDatabase(createNodeSqliteDriver());
  const server = new FakeServer();
  return { db, server };
}

/** The other device's upload of the fixture workout. */
function serverHasFixtureWorkout(server: FakeServer) {
  server.seed('workouts', [strip(WORKOUT)]);
  server.seed('workout_exercises', ENTRIES.map(strip));
  server.seed('sets', SETS.map(strip));
}

async function count(db: Awaited<ReturnType<typeof setup>>['db'], tbl: string, where = '') {
  const row = await db.getFirstAsync<{ n: number }>(`select count(*) as n from ${tbl} ${where}`);
  return row?.n ?? 0;
}

describe('pullChanges', () => {
  it("brings down the user's whole workout tree, and nobody else's workouts", async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    server.seed('workouts', [workoutN(1, OTHER_USER_ID)]);

    const result = await pullChanges(db, server, USER_ID);

    expect(result).toMatchObject({ workouts: 1, workout_exercises: 2, sets: 5 });
    expect(await count(db, 'workouts')).toBe(1);
    const [set] = await getRowsByIds(db, 'sets', [SETS[0].id]);
    expect(strip(set)).toEqual(strip(SETS[0])); // is_warmup true survives the 0/1 trip
    expect(set.is_warmup).toBe(true);
  });

  it('pages through more than one page and stores the bookmark at the last row', async () => {
    const { db, server } = await setup();
    const total = PULL_PAGE_SIZE + 20;
    server.seed('workouts', Array.from({ length: total }, (_, i) => workoutN(i)));

    await pullChanges(db, server, USER_ID);

    expect(await count(db, 'workouts')).toBe(total);
    const last = [...server.tables.workouts.values()].sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).pop();
    expect(await readCursor(db, CURSOR_KEYS.workouts)).toEqual({ updated_at: last?.updated_at, id: last?.id });
  });

  it('skips no row when many share one timestamp across a page boundary', async () => {
    const { db, server } = await setup();
    const sameTime = '2026-11-14T12:30:00.000Z';
    for (let i = 0; i < PULL_PAGE_SIZE + 7; i++) {
      const w = workoutN(i);
      server.tables.workouts.set(w.id, { ...w, updated_at: sameTime });
    }
    await pullChanges(db, server, USER_ID);
    expect(await count(db, 'workouts')).toBe(PULL_PAGE_SIZE + 7);
  });

  it('asks for children at most CHILD_CHUNK_SIZE ids at a time', async () => {
    const { db, server } = await setup();
    server.seed('workouts', Array.from({ length: 250 }, (_, i) => workoutN(i)));
    await pullChanges(db, server, USER_ID);
    expect(server.childRequestSizes.length).toBeGreaterThan(0);
    expect(Math.max(...server.childRequestSizes)).toBeLessThanOrEqual(CHILD_CHUNK_SIZE);
  });

  it('downloads only what changed since the bookmark (plus the overlap margin)', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    // Let the server clock run past the overlap margin (it ticks 1 ms per stamp).
    const passTime = () => {
      for (let i = 0; i < PULL_OVERLAP_MS + 10; i++) server.now();
    };
    passTime();
    server.seed('workouts', [workoutN(9)]);
    await pullChanges(db, server, USER_ID);
    passTime();
    server.seed('workouts', [workoutN(10)]);

    // Only the new workout plus the bookmarked one (inside the overlap margin);
    // the fixture workout, now well behind it, is not downloaded again.
    const third = await pullChanges(db, server, USER_ID);
    expect(third.workouts).toBe(2);
    expect(third.workout_exercises).toBe(0);
    expect(third.sets).toBe(0);
  });

  it('catches a row that landed slightly behind the bookmark (the overlap margin)', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    const cursor = await readCursor(db, CURSOR_KEYS.workouts);
    // A slow server transaction commits a row stamped 2 s before the bookmark.
    const late = workoutN(5);
    const lateTime = new Date(Date.parse(cursor!.updated_at) - 2000).toISOString();
    server.tables.workouts.set(late.id, { ...late, updated_at: lateTime });

    await pullChanges(db, server, USER_ID);
    expect(await getRowsByIds(db, 'workouts', [late.id])).toHaveLength(1);
  });

  it("never overwrites a local edit that hasn't been uploaded yet", async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);

    // Offline edit on this device…
    await writeLocal(db, 'sets', [{ ...SETS[2], reps: 12 }]);
    // …while another device changes the same set on the server.
    server.seed('sets', [{ ...strip(SETS[2]), reps: 1 }]);
    server.seed('workouts', [{ ...strip(WORKOUT), title: 'other device' }]);

    await pullChanges(db, server, USER_ID);
    expect((await getRowsByIds(db, 'sets', [SETS[2].id]))[0].reps).toBe(12);
    expect((await getRowsByIds(db, 'workouts', [WORKOUT.id]))[0].title).toBe(WORKOUT.title);
    // Rows without unsent edits still update.
    expect((await getRowsByIds(db, 'sets', [SETS[3].id]))[0].reps).toBe(SETS[3].reps);

    // Once uploaded, the device's edit is on the server (later upload wins) and pulls back cleanly.
    await pushOutbox(db, server);
    await pullChanges(db, server, USER_ID);
    expect(server.tables.sets.get(SETS[2].id)?.reps).toBe(12);
    expect((await getRowsByIds(db, 'sets', [SETS[2].id]))[0].reps).toBe(12);
  });

  it('accepts an entry whose exercise was deleted on the server (exercise_id null)', async () => {
    const { db, server } = await setup();
    server.seed('workouts', [strip(WORKOUT)]);
    server.seed('workout_exercises', [{ ...strip(ENTRIES[0]), exercise_id: null }]);
    await pullChanges(db, server, USER_ID);
    expect((await getRowsByIds(db, 'workout_exercises', [ENTRIES[0].id]))[0].exercise_id).toBeNull();
  });

  it('brings library edits down onto the device', async () => {
    const { db, server } = await setup();
    const id = libraryExerciseId('bench_press');
    server.seed('exercises', [
      {
        id,
        owner_id: null,
        name: 'Barbell Bench Press',
        primary_muscle: 'Chest',
        equipment: 'Barbell',
        slug: 'bench_press',
        created_at: '2026-11-14T08:00:00.000Z',
      },
    ]);
    const result = await pullChanges(db, server, USER_ID);
    expect(result.exercises).toBe(1);
    expect((await getRowsByIds(db, 'exercises', [id]))[0].name).toBe('Barbell Bench Press');
  });

  it('resumes after a failure mid-pull, keeping the pages already saved', async () => {
    const { db, server } = await setup();
    server.seed('workouts', Array.from({ length: PULL_PAGE_SIZE + 3 }, (_, i) => workoutN(i)));
    const realPull = server.pullWorkouts.bind(server);
    let calls = 0;
    server.pullWorkouts = async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('connection dropped');
      return realPull(...args);
    };

    await expect(pullChanges(db, server, USER_ID)).rejects.toThrow('connection dropped');
    expect(await count(db, 'workouts')).toBe(PULL_PAGE_SIZE);

    await pullChanges(db, server, USER_ID);
    expect(await count(db, 'workouts')).toBe(PULL_PAGE_SIZE + 3);
  });
});

describe('rewind', () => {
  it('moves a bookmark back by the overlap margin, before every id', () => {
    expect(rewind({ updated_at: '2026-11-14T12:00:10.000Z', id: 'x' })).toEqual({
      updated_at: '2026-11-14T12:00:05.000Z',
      id: '00000000-0000-0000-0000-000000000000',
    });
  });

  it("reads Postgres's microsecond timestamps with a time-zone offset", () => {
    expect(rewind({ updated_at: '2026-11-14T12:00:10.123456+00:00', id: 'x' })?.updated_at).toBe(
      '2026-11-14T12:00:05.123Z',
    );
  });

  it('starts from the beginning with no bookmark or an unreadable one', () => {
    expect(rewind(null)).toBeNull();
    expect(rewind({ updated_at: 'garbage', id: 'x' })).toBeNull();
  });
});

/** A 5RM record held by fixture set `setIndex`, for the tombstone tests. */
function record(setIndex = 1, value = 100): PersonalRecordRow {
  return {
    id: 'd0000000-0000-4000-8000-000000000001',
    user_id: USER_ID,
    exercise_id: libraryExerciseId('bench_press'),
    kind: 'repMax',
    reps: 5,
    value_kg: value,
    source_set_id: SETS[setIndex].id,
    created_at: WORKOUT.created_at,
    updated_at: WORKOUT.created_at,
  };
}

/** Another device's change inside the fixture workout: the workout is re-stamped (touch-the-root). */
function touchWorkoutOnServer(server: FakeServer) {
  server.seed('workouts', [strip(WORKOUT)]);
}

describe('pullChanges — deletions arriving from other devices (B14)', () => {
  it('drops sets and exercises the server’s copy of a changed workout no longer has', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);

    await server.deleteRows('sets', [SETS[2].id]);
    await server.deleteRows('workout_exercises', [ENTRIES[1].id]);
    touchWorkoutOnServer(server);
    const result = await pullChanges(db, server, USER_ID);

    expect(result.removed).toBe(4); // set 2; entry 1 and its two sets
    expect(await count(db, 'sets')).toBe(2);
    expect(await count(db, 'workout_exercises')).toBe(1);
  });

  it('spares rows with unsent local changes — offline work against that workout survives', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    // Offline here: a new set logged, and set 2 edited, against the old workout…
    const added = { ...SETS[1], id: 'c0000000-0000-4000-8000-000000009999', position: 3 };
    await writeLocal(db, 'sets', [added, { ...SETS[2], reps: 9 }]);
    // …while another device removed set 2.
    await server.deleteRows('sets', [SETS[2].id]);
    touchWorkoutOnServer(server);
    await pullChanges(db, server, USER_ID);

    expect((await getRowsByIds(db, 'sets', [added.id, SETS[2].id])).map((s) => s.id).sort()).toEqual(
      [added.id, SETS[2].id].sort(),
    );
  });

  it('drops local records citing a removed set, unsent lines included, so the queue cannot jam', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    await writeLocal(db, 'personal_records', [record(2)]); // unsent; cites set 2
    await server.deleteRows('sets', [SETS[2].id]);
    touchWorkoutOnServer(server);
    await pullChanges(db, server, USER_ID);

    expect(await count(db, 'personal_records')).toBe(0);
    expect(await count(db, 'outbox', "where tbl = 'personal_records'")).toBe(0);
    await pushOutbox(db, server); // nothing left that the server would refuse
  });

  it('applies a deleted-workout tombstone: the tree goes with every outbox line about it, even a pending edit', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    server.seed('personal_records', [strip(record(1))]);
    await pullChanges(db, server, USER_ID);
    // An unsent title edit here, while another device deletes the workout.
    await writeLocal(db, 'workouts', [{ ...WORKOUT, title: 'renamed offline' }]);
    await writeLocal(db, 'sets', [{ ...SETS[0], reps: 6 }]);
    await server.deleteRows('workouts', [WORKOUT.id]);
    const result = await pullChanges(db, server, USER_ID);

    expect(result.tombstones).toBeGreaterThanOrEqual(1);
    expect(await count(db, 'workouts')).toBe(0);
    expect(await count(db, 'sets')).toBe(0);
    expect(await count(db, 'personal_records')).toBe(0);
    expect(await count(db, 'outbox')).toBe(0);
    // Nothing is pushed that could re-create a gutted workout on the server.
    await pushOutbox(db, server);
    expect(server.tables.workouts.size).toBe(0);
  });

  it('a record tombstone deletes the local copy, but spares an unsent one and a re-created one', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    server.seed('personal_records', [strip(record(1))]);
    await pullChanges(db, server, USER_ID);

    // Plain deletion: the record goes.
    await server.deleteRows('personal_records', [record().id]);
    await pullChanges(db, server, USER_ID);
    expect(await count(db, 'personal_records')).toBe(0);

    // Demotion on another device: deleted, then re-created under the same id (later stamp).
    server.seed('personal_records', [strip(record(1))]);
    await pullChanges(db, server, USER_ID);
    await server.deleteRows('personal_records', [record().id]);
    server.seed('personal_records', [strip(record(3, 90))]);
    await pullChanges(db, server, USER_ID);
    expect((await getRowsByIds(db, 'personal_records', [record().id]))[0]?.value_kg).toBe(90);

    // An unsent local record survives a tombstone; its own upload settles the server.
    await writeLocal(db, 'personal_records', [record(1, 110)]);
    await server.deleteRows('personal_records', [record().id]);
    await pullChanges(db, server, USER_ID);
    expect((await getRowsByIds(db, 'personal_records', [record().id]))[0]?.value_kg).toBe(110);
  });

  it('keeps a tombstone bookmark, so each tombstone is applied once', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    await server.deleteRows('workouts', [WORKOUT.id]);
    expect((await pullChanges(db, server, USER_ID)).tombstones).toBe(1);
    // The same workout id arriving again later (re-synced) is not deleted by the old tombstone.
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    expect(await count(db, 'workouts')).toBe(1);
    expect(await db.getFirstAsync('select value from sync_state where key = ?', [TOMBSTONE_CURSOR_KEY])).toEqual({
      value: '1',
    });
  });

  it('never reads another user’s tombstones', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    server.seed('workouts', [workoutN(7, OTHER_USER_ID)]);
    await server.deleteRows('workouts', [workoutN(7, OTHER_USER_ID).id]);
    expect((await pullChanges(db, server, USER_ID)).tombstones).toBe(0);
  });
});

describe('B15: the settings row', () => {
  it('a unit changed on another device lands in the local row and is handed to the callback', async () => {
    const { db, server } = await setup();
    server.seedUserSettings(USER_ID, 'kg');
    const pulled: UserSettingsRow[] = [];

    const result = await pullChanges(db, server, USER_ID, { onUserSettingsPulled: (row) => pulled.push(row) });

    expect(result.userSettings).toBe(1);
    const local = await readUserSettingsRow(db, USER_ID);
    expect(local).toEqual(server.userSettings.get(USER_ID));
    expect(pulled).toEqual([local]);
  });

  it('never overwrites an unsent local toggle, and doesn’t report it', async () => {
    const { db, server } = await setup();
    server.seedUserSettings(USER_ID, 'lb');
    await createUnitStore().setUnit(db, USER_ID, 'kg', { now: '2026-11-15T00:00:00.000Z' });
    const pulled: UserSettingsRow[] = [];

    const result = await pullChanges(db, server, USER_ID, { onUserSettingsPulled: (row) => pulled.push(row) });

    expect(result.userSettings).toBe(0);
    expect((await readUserSettingsRow(db, USER_ID))?.unit).toBe('kg');
    expect(pulled).toEqual([]);
  });

  it('saves nothing when the server shows no settings row', async () => {
    const { db, server } = await setup();
    expect((await pullChanges(db, server, USER_ID)).userSettings).toBe(0);
    expect(await readUserSettingsRow(db, USER_ID)).toBeNull();
  });

  it('round trip (B15): toggle offline → push → the server copy flows back and the local row matches', async () => {
    const { db, server } = await setup();
    server.seedUserSettings(USER_ID, 'lb');
    await createUnitStore().setUnit(db, USER_ID, 'kg');
    await pushOutbox(db, server);
    await pullChanges(db, server, USER_ID);
    expect(await readUserSettingsRow(db, USER_ID)).toEqual(server.userSettings.get(USER_ID));
  });
});

describe('B21: the flair list and posts', () => {
  it('brings down the whole flair list, and a later download replaces it (a new flair is data)', async () => {
    const { db, server } = await setup();
    expect((await pullChanges(db, server, USER_ID)).flairs).toBe(4);
    expect((await readFlairs(db)).map((f) => f.name)).toEqual(['WOD', 'Physique Check', 'New PR', 'Form Check']);
    expect((await readFlairs(db))[1].upvotes_only).toBe(true);

    server.flairs.push({ id: 'deadlift-day', name: 'Deadlift Day', position: 5, upvotes_only: false });
    await pullChanges(db, server, USER_ID);
    expect((await readFlairs(db)).map((f) => f.id)).toContain('deadlift-day');
  });

  it('a failed flair read is recorded, not thrown: everything else is saved and the old flairs stay', async () => {
    const { db, server } = await setup();
    await pullChanges(db, server, USER_ID);
    serverHasFixtureWorkout(server);
    server.failFlairs = true;

    const result = await pullChanges(db, server, USER_ID);
    expect(result.flairsError).toBeInstanceOf(Error);
    expect(result.flairs).toBe(0);
    expect(result.workouts).toBe(1);
    expect(await readFlairs(db)).toHaveLength(4);
  });

  it('a workout deleted on another device takes this phone’s queued post of it, and its line', async () => {
    const { db, server } = await setup();
    serverHasFixtureWorkout(server);
    await pullChanges(db, server, USER_ID);
    await createWorkoutPost(db, USER_ID, WORKOUT.id, 'wod');
    expect(await count(db, 'outbox', "where tbl = 'posts'")).toBe(1);

    await server.deleteRows('workouts', [WORKOUT.id]);
    await pullChanges(db, server, USER_ID);
    expect(await count(db, 'posts')).toBe(0);
    expect(await count(db, 'outbox')).toBe(0);
  });
});
