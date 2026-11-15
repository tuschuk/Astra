/**
 * Tests for the muscle map's data on the phone (ANA-3): driven by the exercises actually logged,
 * merged by the shared rule, and blind to empty slots, custom exercises and other users' workouts.
 * Real SQLite (node driver) with the seeded library, never the live project.
 */
import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import type { SqlDriver } from '@/db/driver';
import { PATTERN_MUSCLES } from '@/library/exercises';
import { libraryExerciseId } from '@/library/uuidv5';
import { steadyOptions } from '@/test-utils/loggerTestKit';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { USER_ID } from '@/test-utils/workoutFixtures';
import { startActiveWorkout } from '@/workout/activeWorkout';

import { sessionMuscleLoads } from './muscles';

const BENCH = libraryExerciseId('bench_press');
const SQUAT = libraryExerciseId('squat');
const CUSTOM = 'c0000000-0000-4000-8000-000000000001';

async function freshDb(): Promise<SqlDriver> {
  return prepareDatabase(createNodeSqliteDriver());
}

/** Adds a custom exercise (no library slug) owned by `owner`. */
async function addCustom(db: SqlDriver, owner = USER_ID): Promise<void> {
  await db.runAsync(
    `insert into exercises (id, owner_id, name, primary_muscle, equipment, slug, created_at, updated_at)
     values (?, ?, 'My Press', 'Chest', 'Machine', null, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`,
    [CUSTOM, owner],
  );
}

describe('sessionMuscleLoads', () => {
  it('a bench-only session is chest, shoulders and triceps — the library’s own values', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    const { id } = await store.finish();
    expect(await sessionMuscleLoads(db, USER_ID, id)).toEqual(PATTERN_MUSCLES['Horizontal Push']);
    expect(await sessionMuscleLoads(db, USER_ID, id)).toEqual({ chest: 1, shoulders: 0.4, triceps: 0.25 });
  });

  it('two exercises give every muscle either trained, each at the higher value', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    const squat = await store.addExercise(SQUAT);
    await store.logSet(squat.id, { reps: 5, weight: { value: 140, unit: 'kg' } });
    const { id } = await store.finish();
    expect(await sessionMuscleLoads(db, USER_ID, id)).toEqual({
      chest: 1,
      shoulders: 0.4,
      triceps: 0.25,
      quads: 1,
      glutes: 0.5,
      hamstrings: 0.2,
    });
  });

  it('counts warm-up-only work, but an exercise with no sets adds nothing', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 10, weight: { value: 40, unit: 'kg' }, isWarmup: true });
    await store.addExercise(SQUAT); // added, never done
    const { id } = await store.finish();
    expect(await sessionMuscleLoads(db, USER_ID, id)).toEqual({ chest: 1, shoulders: 0.4, triceps: 0.25 });
  });

  it('a custom exercise adds nothing (no library muscle data), even beside library work', async () => {
    const db = await freshDb();
    await addCustom(db);
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    const custom = await store.addExercise(CUSTOM);
    await store.logSet(custom.id, { reps: 10 });
    const first = await store.finish();
    expect(await sessionMuscleLoads(db, USER_ID, first.id)).toEqual({});

    const next = await startActiveWorkout(db, USER_ID, steadyOptions('2026-11-14T12:00:00.000Z'));
    const again = await next.addExercise(CUSTOM);
    await next.logSet(again.id, { reps: 10 });
    const squat = await next.addExercise(SQUAT);
    await next.logSet(squat.id, { reps: 5 });
    const second = await next.finish();
    expect(await sessionMuscleLoads(db, USER_ID, second.id)).toEqual({ quads: 1, glutes: 0.5, hamstrings: 0.2 });
  });

  it('an exercise whose slug the bundled library no longer knows adds nothing', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5 });
    const { id } = await store.finish();
    await db.runAsync("update exercises set slug = 'retired_exercise' where id = ?", [BENCH]);
    expect(await sessionMuscleLoads(db, USER_ID, id)).toEqual({});
  });

  it('never reads another user’s workout, and an unknown id is empty', async () => {
    const db = await freshDb();
    const store = await startActiveWorkout(db, USER_ID, steadyOptions());
    const bench = await store.addExercise(BENCH);
    await store.logSet(bench.id, { reps: 5 });
    const { id } = await store.finish();
    expect(await sessionMuscleLoads(db, '22222222-2222-4222-8222-222222222222', id)).toEqual({});
    expect(await sessionMuscleLoads(db, USER_ID, 'missing')).toEqual({});
  });
});
