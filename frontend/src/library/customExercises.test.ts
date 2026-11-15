/**
 * Tests for custom exercises (LIB-5, B31): create / edit / soft-delete through the outbox, the
 * owner-only reads, the Library filter rules, the name limit, and the sync behaviour the plan pins
 * — a custom made offline lands on the (fake) server exactly once after reconnect, a delete arrives
 * as an update with `deleted_at`, and a soft-deleted row pulled from the server drops out of the
 * list. Real SQLite (node driver); the fake server stands in for Supabase.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { getRowsByIds, type ExerciseRow } from '@/db/dao';
import type { SqlDriver } from '@/db/driver';
import { pendingRows } from '@/sync/outbox';
import { pullChanges } from '@/sync/pull';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { libraryExerciseId } from '@/library/uuidv5';
import { startActiveWorkout } from '@/workout/activeWorkout';
import { exerciseInfo } from '@/workout/history';
import { currentPrs } from '@/workout/prs';

import {
  createCustomExercise,
  deleteCustomExercise,
  filterCustomExercises,
  getCustomExercise,
  listCustomExercises,
  updateCustomExercise,
} from './customExercises';

const USER = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const T0 = '2026-11-15T10:00:00.000Z';
const T1 = '2026-11-15T11:00:00.000Z';
const T2 = '2026-11-15T12:00:00.000Z';

let db: SqlDriver;
let ids = 0;
/** Predictable ids for new customs. */
const newId = () => `c0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

beforeEach(async () => {
  db = await prepareDatabase(createNodeSqliteDriver());
  ids = 0;
});

describe('createCustomExercise', () => {
  it('saves a trimmed, owned, slug-less, live row and queues it for upload', async () => {
    const row = await createCustomExercise(
      db,
      USER,
      { name: '  Landmine Press ', equipment: 'Barbell', primaryMuscle: 'shoulders' },
      { now: T0, newId },
    );
    expect(row).toEqual({
      id: 'c0000000-0000-4000-8000-000000000001',
      owner_id: USER,
      name: 'Landmine Press',
      primary_muscle: 'shoulders',
      equipment: 'Barbell',
      slug: null,
      deleted_at: null,
      created_at: T0,
      updated_at: T0,
    });
    expect(await getRowsByIds(db, 'exercises', [row.id])).toEqual([row]);
    expect((await pendingRows(db, 'exercises')).map((p) => p.rowId)).toEqual([row.id]);
  });

  it('refuses a blank or over-long name and saves nothing', async () => {
    await expect(createCustomExercise(db, USER, { name: '   ', equipment: null, primaryMuscle: null })).rejects.toThrow(
      RangeError,
    );
    await expect(
      createCustomExercise(db, USER, { name: 'x'.repeat(81), equipment: null, primaryMuscle: null }),
    ).rejects.toThrow(/80/);
    expect(await listCustomExercises(db, USER)).toEqual([]);
    expect(await pendingRows(db, 'exercises')).toEqual([]);
  });

  it('accepts a name of exactly 80 characters', async () => {
    const row = await createCustomExercise(db, USER, { name: 'x'.repeat(80), equipment: null, primaryMuscle: null });
    expect(row.name).toHaveLength(80);
  });
});

describe('updateCustomExercise', () => {
  it('changes the fields, keeps id / owner / created_at, and queues the edit', async () => {
    const made = await createCustomExercise(db, USER, { name: 'Belt Squat', equipment: null, primaryMuscle: null }, { now: T0, newId });
    const edited = await updateCustomExercise(
      db,
      USER,
      made.id,
      { name: 'Belt Squat (high)', equipment: 'Machine', primaryMuscle: 'quads' },
      { now: T1 },
    );
    expect(edited).toEqual({ ...made, name: 'Belt Squat (high)', equipment: 'Machine', primary_muscle: 'quads', updated_at: T1 });
    expect(await getCustomExercise(db, USER, made.id)).toEqual(edited);
  });

  it('refuses another lifter’s exercise, a library exercise, an unknown id, and a deleted one', async () => {
    const theirs = await createCustomExercise(db, OTHER, { name: 'Theirs', equipment: null, primaryMuscle: null }, { newId });
    const mine = await createCustomExercise(db, USER, { name: 'Mine', equipment: null, primaryMuscle: null }, { newId });
    await deleteCustomExercise(db, USER, mine.id);
    const input = { name: 'Hijack', equipment: null, primaryMuscle: null };
    await expect(updateCustomExercise(db, USER, theirs.id, input)).rejects.toThrow(/not one of/);
    await expect(updateCustomExercise(db, USER, libraryExerciseId('bench_press'), input)).rejects.toThrow(/not one of/);
    await expect(updateCustomExercise(db, USER, 'nope', input)).rejects.toThrow(/not one of/);
    // An edit is an upsert, so this refusal is what stops an edit resurrecting a deleted exercise.
    await expect(updateCustomExercise(db, USER, mine.id, input)).rejects.toThrow(/deleted/);
    expect((await getRowsByIds(db, 'exercises', [theirs.id, mine.id])).map((r) => r.name).sort()).toEqual(['Mine', 'Theirs']);
  });
});

describe('deleteCustomExercise', () => {
  it('stamps deleted_at (a soft delete), hides it from the reads, and queues an upsert line', async () => {
    const made = await createCustomExercise(db, USER, { name: 'Gone Soon', equipment: null, primaryMuscle: null }, { now: T0, newId });
    await deleteCustomExercise(db, USER, made.id, { now: T1 });
    const [stored] = await getRowsByIds(db, 'exercises', [made.id]);
    expect(stored).toEqual({ ...made, deleted_at: T1, updated_at: T1 });
    expect(await listCustomExercises(db, USER)).toEqual([]);
    expect(await getCustomExercise(db, USER, made.id)).toBeNull();
    // An upload of the stamped row, never a delete line: the server sees an ordinary update.
    expect((await pendingRows(db, 'exercises')).map((p) => p.rowId)).toEqual([made.id]);
    expect(await pendingRows(db, 'exercises', 'delete')).toEqual([]);
  });

  it('refuses twice, and refuses someone else’s exercise', async () => {
    const theirs = await createCustomExercise(db, OTHER, { name: 'Theirs', equipment: null, primaryMuscle: null }, { newId });
    const mine = await createCustomExercise(db, USER, { name: 'Mine', equipment: null, primaryMuscle: null }, { newId });
    await deleteCustomExercise(db, USER, mine.id);
    await expect(deleteCustomExercise(db, USER, mine.id)).rejects.toThrow(/deleted/);
    await expect(deleteCustomExercise(db, USER, theirs.id)).rejects.toThrow(/not one of/);
    expect(await getCustomExercise(db, OTHER, theirs.id)).not.toBeNull();
  });

  it('keeps the name on logged history and the PRs, so past sessions still read right', async () => {
    const made = await createCustomExercise(db, USER, { name: 'Zercher Squat', equipment: 'Barbell', primaryMuscle: 'quads' });
    const store = await startActiveWorkout(db, USER);
    const entry = await store.addExercise(made.id);
    await store.logSet(entry.id, { reps: 5, weight: { value: 100, unit: 'kg' } });
    await store.finish();
    expect((await currentPrs(db, USER, made.id)).length).toBeGreaterThan(0);

    await deleteCustomExercise(db, USER, made.id);
    expect(await exerciseInfo(db, USER, made.id)).toEqual({ name: 'Zercher Squat', equipment: 'Barbell' });
    expect((await currentPrs(db, USER, made.id)).length).toBeGreaterThan(0);
  });
});

describe('listCustomExercises / getCustomExercise', () => {
  it('returns only this lifter’s live customs, by name ignoring case — never library rows', async () => {
    await createCustomExercise(db, USER, { name: 'zottman curl', equipment: null, primaryMuscle: null }, { newId });
    await createCustomExercise(db, USER, { name: 'Belt Squat', equipment: null, primaryMuscle: null }, { newId });
    await createCustomExercise(db, OTHER, { name: 'Another Lifter’s', equipment: null, primaryMuscle: null }, { newId });
    expect((await listCustomExercises(db, USER)).map((r) => r.name)).toEqual(['Belt Squat', 'zottman curl']);
    expect(await getCustomExercise(db, USER, libraryExerciseId('bench_press'))).toBeNull();
  });

  it('a custom never leaks to another account on the same phone', async () => {
    const mine = await createCustomExercise(db, USER, { name: 'Mine', equipment: null, primaryMuscle: null }, { newId });
    expect(await getCustomExercise(db, OTHER, mine.id)).toBeNull();
    expect(await listCustomExercises(db, OTHER)).toEqual([]);
  });
});

describe('filterCustomExercises', () => {
  /** A minimal custom row for the pure filter. */
  const row = (name: string, equipment: string | null, muscle: string | null): ExerciseRow => ({
    id: name,
    owner_id: USER,
    name,
    primary_muscle: muscle,
    equipment,
    slug: null,
    deleted_at: null,
    created_at: T0,
    updated_at: T0,
  });
  const rows = [row('Zercher Carry', 'Barbell', 'biceps'), row('Zottman Curl', 'Dumbbell', 'biceps'), row('Odd One', null, null)];

  it('keeps everything with no filters, in the given order', () => {
    expect(filterCustomExercises(rows, {})).toEqual(rows);
  });

  it('search is a case-insensitive name-contains match, ignoring surrounding spaces', () => {
    expect(filterCustomExercises(rows, { query: '  ZOTT ' }).map((r) => r.name)).toEqual(['Zottman Curl']);
  });

  it('equipment and muscle match exactly and combine', () => {
    expect(filterCustomExercises(rows, { equipment: 'Barbell' }).map((r) => r.name)).toEqual(['Zercher Carry']);
    expect(filterCustomExercises(rows, { muscle: 'biceps' })).toHaveLength(2);
    expect(filterCustomExercises(rows, { muscle: 'biceps', equipment: 'Dumbbell', query: 'z' }).map((r) => r.name)).toEqual([
      'Zottman Curl',
    ]);
    expect(filterCustomExercises(rows, { muscle: 'chest' })).toEqual([]);
  });

  it('any body-region chip hides every custom (customs carry no region)', () => {
    for (const body of ['upper', 'lower', 'core', 'cardio'] as const) {
      expect(filterCustomExercises(rows, { body })).toEqual([]);
    }
  });
});

describe('sync (the plan’s pinned behaviour)', () => {
  it('a custom made offline reaches the server exactly once after reconnect, owned by the lifter', async () => {
    const server = new FakeServer();
    server.offline = true; // airplane mode
    const made = await createCustomExercise(db, USER, { name: 'Offline Lift', equipment: null, primaryMuscle: null }, { now: T0, newId });
    await expect(pushOutbox(db, server)).rejects.toThrow();
    expect(await pendingRows(db, 'exercises')).toHaveLength(1);

    server.offline = false;
    await pushOutbox(db, server);
    await pushOutbox(db, server);
    expect(server.tables.exercises.size).toBe(1);
    expect(server.tables.exercises.get(made.id)).toMatchObject({ owner_id: USER, slug: null, deleted_at: null });
    expect(server.upsertCalls.filter((c) => c.tbl === 'exercises' && c.ids.includes(made.id))).toHaveLength(2);
    expect(await pendingRows(db, 'exercises')).toEqual([]);
  });

  it('a delete reaches the server as an update carrying deleted_at, never a delete request', async () => {
    const server = new FakeServer();
    const made = await createCustomExercise(db, USER, { name: 'Short Lived', equipment: null, primaryMuscle: null }, { now: T0, newId });
    await pushOutbox(db, server);
    await deleteCustomExercise(db, USER, made.id, { now: T1 });
    await pushOutbox(db, server);
    expect(server.tables.exercises.get(made.id)).toMatchObject({ name: 'Short Lived', deleted_at: T1 });
    expect(server.deleteCalls).toEqual([]);
  });

  it('a soft delete pulled from the server (another phone) drops the custom from the list', async () => {
    const server = new FakeServer();
    const made = await createCustomExercise(db, USER, { name: 'Two Phones', equipment: null, primaryMuscle: null }, { now: T0, newId });
    await pushOutbox(db, server);
    const { updated_at: _stamp, ...fields } = made;
    server.seed('exercises', [{ ...fields, deleted_at: T2 }]);
    await pullChanges(db, server, USER);
    expect(await listCustomExercises(db, USER)).toEqual([]);
    expect((await getRowsByIds(db, 'exercises', [made.id]))[0].deleted_at).toBe(T2);
  });
});
