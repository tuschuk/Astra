/**
 * Tests for the sync engine's timing: one sync at a time, requests folded
 * together, and the automatic triggers (start, foreground, reconnect, local
 * change).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { writeLocal } from '@/db/dao';
import type { AppStateLike } from '@/lib/supabase';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import { SyncEngine, type NetworkSourceLike } from './engine';
import { outboxSize } from './outbox';

const quiet = () => undefined;

async function setup() {
  const db = await prepareDatabase(createNodeSqliteDriver());
  const server = new FakeServer();
  const engine = new SyncEngine({ db, transport: server, userId: USER_ID, debounceMs: 50, log: quiet });
  return { db, server, engine };
}

/** A fake AppState whose changes the test fires by hand. */
function fakeAppState() {
  const listeners = new Set<(s: string) => void>();
  const appState: AppStateLike = {
    currentState: 'active',
    addEventListener: (_type, listener) => {
      listeners.add(listener as (s: string) => void);
      return { remove: () => listeners.delete(listener as (s: string) => void) };
    },
  };
  return { appState, emit: (s: string) => listeners.forEach((l) => l(s)), listeners };
}

/** A fake network source whose state changes the test fires by hand. */
function fakeNetwork() {
  const listeners = new Set<(s: { isConnected?: boolean; isInternetReachable?: boolean }) => void>();
  const network: NetworkSourceLike = {
    addNetworkStateListener: (listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    network,
    emit: (s: { isConnected?: boolean; isInternetReachable?: boolean }) => listeners.forEach((l) => l(s)),
    listeners,
  };
}

describe('SyncEngine.syncNow', () => {
  it('runs one sync at a time and folds overlapping requests into one follow-up', async () => {
    const { db, server, engine } = await setup();
    await writeLocal(db, 'workouts', [WORKOUT]);
    let concurrent = 0;
    let maxConcurrent = 0;
    let runs = 0;
    const realUpsert = server.upsert.bind(server);
    server.upsert = async (...args) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      return realUpsert(...args);
    };
    const realPull = server.pullExercises.bind(server);
    server.pullExercises = async (...args) => {
      runs += 1;
      return realPull(...args);
    };

    await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);
    expect(maxConcurrent).toBe(1);
    expect(runs).toBe(2); // the first run, plus exactly one follow-up
  });

  it('never rejects: failures are reported in the result and to the log', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const server = new FakeServer();
    server.offline = true;
    const log = jest.fn();
    const engine = new SyncEngine({ db, transport: server, userId: USER_ID, log });
    await writeLocal(db, 'workouts', [WORKOUT]);
    const result = await engine.syncNow();
    expect(result.pushError).toBeDefined();
    expect(result.pullError).toBeDefined();
    expect(log).toHaveBeenCalledTimes(2);
    expect(await outboxSize(db)).toBe(1);
  });

  it('still downloads when an upload keeps failing', async () => {
    const { db, server, engine } = await setup();
    await writeLocal(db, 'workouts', [WORKOUT]);
    server.failUpsertsOn('workouts');
    server.seed('workouts', [{ ...WORKOUT, id: 'a2000000-0000-4000-8000-000000000001' }]);
    const result = await engine.syncNow();
    expect(result.pushError).toBeDefined();
    expect(result.pull?.workouts).toBe(1);
  });
});

describe('SyncEngine.start (automatic triggers)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('syncs on start, foreground, reconnect and local change — and stops cleanly', async () => {
    const { db, engine } = await setup();
    const spy = jest.spyOn(engine, 'syncNow').mockResolvedValue({ push: null, pull: null });
    const app = fakeAppState();
    const net = fakeNetwork();

    const stop = engine.start({ appState: app.appState, network: net.network });
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(1); // on start

    app.emit('background');
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(1); // backgrounding doesn't sync
    app.emit('active');
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(2);

    net.emit({ isConnected: false });
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(2); // losing signal doesn't sync
    net.emit({ isConnected: true, isInternetReachable: true });
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(3);

    await writeLocal(db, 'workouts', [WORKOUT]);
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(4);

    stop();
    expect(app.listeners.size).toBe(0);
    expect(net.listeners.size).toBe(0);
    app.emit('active');
    await writeLocal(db, 'workouts', [WORKOUT]);
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('folds a burst of requests into one sync', async () => {
    const { engine } = await setup();
    const spy = jest.spyOn(engine, 'syncNow').mockResolvedValue({ push: null, pull: null });
    engine.requestSync();
    engine.requestSync();
    jest.advanceTimersByTime(20);
    engine.requestSync();
    jest.advanceTimersByTime(60);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('SyncEngine — deletions from other devices (B14)', () => {
  it('reads tombstones BEFORE uploading, so an unsent edit cannot re-create a workout deleted elsewhere', async () => {
    const { db, server, engine } = await setup();
    await writeLocal(db, 'workouts', [WORKOUT]);
    await engine.syncNow();
    expect(server.tables.workouts.has(WORKOUT.id)).toBe(true);

    // Offline here: the title is edited. Meanwhile another device deletes the workout.
    await writeLocal(db, 'workouts', [{ ...WORKOUT, title: 'renamed offline' }]);
    await server.deleteRows('workouts', [WORKOUT.id]);

    await engine.syncNow();
    expect(server.tables.workouts.has(WORKOUT.id)).toBe(false);
    expect(await db.getFirstAsync('select count(*) as n from workouts')).toEqual({ n: 0 });
    expect(await outboxSize(db)).toBe(0);
  });
});
