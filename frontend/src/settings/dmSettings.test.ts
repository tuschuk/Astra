/**
 * Tests for the "who can message you" setting on the phone (B48), on real SQLite: 'anyone' by
 * default, saving changes exactly that column with one upload line in the same transaction, a
 * failed save stores nothing, and an offline choice survives the app dying and reaches the (fake)
 * server exactly once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { onLocalWrite } from '@/db/dao';
import { DEFAULT_USER_SETTINGS, readUserSettingsRow, writeUserSettingsRowTx } from '@/db/userSettings';
import { pendingRows } from '@/sync/outbox';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { USER_ID } from '@/test-utils/workoutFixtures';

import { readDmPolicy, setDmPolicy } from './dmSettings';

describe('who can message you', () => {
  it("is 'anyone' when the lifter has no settings row yet", async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    expect(await readDmPolicy(db, USER_ID)).toBe('anyone');
  });

  it('saving changes only dm_policy, queues exactly one upload and wakes the sync engine', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync((tx) =>
      writeUserSettingsRowTx(tx, {
        ...DEFAULT_USER_SETTINGS,
        user_id: USER_ID,
        unit: 'kg',
        progress_pic_visibility: 'followers',
        notify_messages: false,
        updated_at: 't0',
      }),
    );
    const heard: string[] = [];
    const unsubscribe = onLocalWrite(db, (tbl) => heard.push(tbl));

    await setDmPolicy(db, USER_ID, 'mutual_follows', { now: 't1' });

    expect(await readUserSettingsRow(db, USER_ID)).toEqual({
      ...DEFAULT_USER_SETTINGS,
      user_id: USER_ID,
      unit: 'kg',
      progress_pic_visibility: 'followers',
      notify_messages: false,
      dm_policy: 'mutual_follows',
      updated_at: 't1',
    });
    expect((await pendingRows(db, 'user_settings')).map((p) => p.rowId)).toEqual([USER_ID]);
    expect(heard).toEqual(['user_settings']);
    unsubscribe();

    await setDmPolicy(db, USER_ID, 'anyone');
    expect(await readDmPolicy(db, USER_ID)).toBe('anyone');
  });

  it('a failed save stores and queues nothing', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.execAsync('drop table outbox');
    await expect(setDmPolicy(db, USER_ID, 'mutual_follows')).rejects.toThrow();
    expect(await readUserSettingsRow(db, USER_ID)).toBeNull();
  });

  it('a choice made offline survives the app dying, then one healed sync lands it once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-b48-'));
    const file = join(dir, 'astra.db');
    try {
      const server = new FakeServer();
      server.seedUserSettings(USER_ID, 'lb');
      server.offline = true;
      const before = await prepareDatabase(createNodeSqliteDriver(file));
      await setDmPolicy(before, USER_ID, 'mutual_follows');
      await expect(pushOutbox(before, server)).rejects.toThrow('Network request failed');

      const after = await prepareDatabase(createNodeSqliteDriver(file));
      expect(await readDmPolicy(after, USER_ID)).toBe('mutual_follows');
      server.offline = false;
      expect((await pushOutbox(after, server)).userSettings).toBe(1);
      expect(server.userSettings.get(USER_ID)).toMatchObject({ unit: 'lb', dm_policy: 'mutual_follows', notify_messages: true });
      expect((await pushOutbox(after, server)).userSettings).toBe(0);
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may still hold the file open; the temp folder is cleaned up eventually.
      }
    }
  });
});
