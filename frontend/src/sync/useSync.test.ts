/**
 * Tests for the root-layout sync hook: the database opens on launch, an
 * engine runs only while someone is signed in, and it stops on sign-out.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';

import { prepareDatabase } from '@/db/database';
import type { SqlDriver } from '@/db/driver';
import { writeLocal } from '@/db/dao';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { USER_ID, WORKOUT } from '@/test-utils/workoutFixtures';

import type { NetworkSourceLike } from './engine';
import { outboxSize } from './outbox';
import { useSync, type SyncDeps } from './useSync';

function makeDeps(db: SqlDriver, server: FakeServer) {
  const removeNetwork = jest.fn();
  const network: NetworkSourceLike = { addNetworkStateListener: () => ({ remove: removeNetwork }) };
  const openDatabase = jest.fn(async () => db);
  const deps: SyncDeps = { openDatabase, createTransport: () => server, triggers: () => ({ network }) };
  return { deps, openDatabase, removeNetwork };
}

describe('useSync', () => {
  it('opens the database but runs no engine while signed out', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const server = new FakeServer();
    const { deps, openDatabase } = makeDeps(db, server);
    await renderHook(() => useSync(null, deps));
    await waitFor(() => expect(openDatabase).toHaveBeenCalled());
    await writeLocal(db, 'workouts', [WORKOUT]);
    await new Promise((r) => setTimeout(r, 900));
    expect(server.upsertCalls).toEqual([]);
  });

  it('syncs a signed-in user automatically, and stops the engine on sign-out', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const server = new FakeServer();
    await writeLocal(db, 'workouts', [WORKOUT]);
    const { deps, removeNetwork } = makeDeps(db, server);

    const { rerender } = await renderHook(({ userId }: { userId: string | null }) => useSync(userId, deps), {
      initialProps: { userId: USER_ID as string | null },
    });
    await waitFor(async () => expect(await outboxSize(db)).toBe(0), { timeout: 5000 });
    expect(server.tables.workouts.size).toBe(1);

    await rerender({ userId: null });
    expect(removeNetwork).toHaveBeenCalled();
  });
});
