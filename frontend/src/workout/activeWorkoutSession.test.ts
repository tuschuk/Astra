/**
 * Tests for the session slot that shares one active-workout store between screens: start,
 * resume (including after a simulated relaunch), clear, account mismatch, and subscribers.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { libraryExerciseId } from '@/library/uuidv5';
import { createPreparedDb } from '@/test-utils/loggerTestKit';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { OTHER_USER_ID, USER_ID } from '@/test-utils/workoutFixtures';

import {
  clearSessionWorkout,
  currentSessionWorkout,
  resumeSessionWorkout,
  startSessionWorkout,
  subscribeSessionWorkout,
} from './activeWorkoutSession';

const BENCH = libraryExerciseId('bench_press');
const dirs: string[] = [];

afterEach(() => clearSessionWorkout());
afterAll(() => {
  // The "killed" connection is never closed (that is the point), so Windows may still hold the
  // file; a leftover in the OS temp folder is harmless.
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('active-workout session slot', () => {
  it('start puts the store in the slot for that user only', async () => {
    const db = await createPreparedDb();
    const store = await startSessionWorkout(db, USER_ID);
    expect(currentSessionWorkout(USER_ID)).toBe(store);
    expect(currentSessionWorkout(OTHER_USER_ID)).toBeNull();
  });

  it('resume hands back the same store while it is active', async () => {
    const db = await createPreparedDb();
    const store = await startSessionWorkout(db, USER_ID);
    expect(await resumeSessionWorkout(db, USER_ID)).toBe(store);
  });

  it('resume rebuilds the workout from the database after a relaunch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-session-'));
    dirs.push(dir);
    const file = join(dir, 'astra.db');
    const before = await startSessionWorkout(await prepareDatabase(createNodeSqliteDriver(file)), USER_ID);
    const entry = await before.addExercise(BENCH);
    await before.logSet(entry.id, { reps: 5, weight: { value: 100, unit: 'kg' } });

    // "Kill" the app: the in-memory slot is gone, a new connection opens the same file.
    clearSessionWorkout();
    const after = await resumeSessionWorkout(await prepareDatabase(createNodeSqliteDriver(file)), USER_ID);
    expect(after).not.toBe(before);
    expect(after?.getSnapshot()).toEqual(before.getSnapshot());
    expect(currentSessionWorkout(USER_ID)).toBe(after);
  });

  it('resume returns null and empties the slot when nothing is in progress', async () => {
    const db = await createPreparedDb();
    const store = await startSessionWorkout(db, USER_ID);
    await store.finish();
    expect(await resumeSessionWorkout(db, USER_ID)).toBeNull();
    expect(currentSessionWorkout(USER_ID)).toBeNull();
  });

  it('a different signed-in user never gets the previous user’s store', async () => {
    const db = await createPreparedDb();
    await startSessionWorkout(db, USER_ID);
    expect(await resumeSessionWorkout(db, OTHER_USER_ID)).toBeNull();
    expect(currentSessionWorkout(USER_ID)).toBeNull();
    // The first user's draft is still on the phone, offered again when they sign back in.
    expect(await resumeSessionWorkout(db, USER_ID)).not.toBeNull();
  });

  it('starting for a new user drops the old user’s store first', async () => {
    const db = await createPreparedDb();
    await startSessionWorkout(db, USER_ID);
    const theirs = await startSessionWorkout(db, OTHER_USER_ID);
    expect(currentSessionWorkout(OTHER_USER_ID)).toBe(theirs);
    expect(currentSessionWorkout(USER_ID)).toBeNull();
  });

  it('a refused start leaves the slot as it was', async () => {
    const db = await createPreparedDb();
    const store = await startSessionWorkout(db, USER_ID);
    await expect(startSessionWorkout(db, USER_ID)).rejects.toThrow(/already in progress/);
    expect(currentSessionWorkout(USER_ID)).toBe(store);
  });

  it('tells subscribers when the slot changes, and only then', async () => {
    const db = await createPreparedDb();
    const listener = jest.fn();
    const stop = subscribeSessionWorkout(listener);
    const store = await startSessionWorkout(db, USER_ID);
    expect(listener).toHaveBeenCalledTimes(1);
    await resumeSessionWorkout(db, USER_ID); // same store: no change
    expect(listener).toHaveBeenCalledTimes(1);
    await store.discard();
    clearSessionWorkout();
    expect(listener).toHaveBeenCalledTimes(2);
    clearSessionWorkout(); // already empty: no change
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    await startSessionWorkout(db, USER_ID);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
