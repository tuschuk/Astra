/**
 * Tests for the progress-pic privacy setting on the phone (B26), on real SQLite: the private
 * default, saving with one upload line in one transaction (the unit left alone), the wake-up for
 * the sync engine, and a choice made with no signal surviving the app dying and landing on the
 * (fake) server exactly once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { onLocalWrite } from '@/db/dao';
import { readUserSettingsRow, writeUserSettingsRowTx } from '@/db/userSettings';
import { pendingRows } from '@/sync/outbox';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { USER_ID } from '@/test-utils/workoutFixtures';

import { readProgressPicVisibility, setProgressPicVisibility } from './privacySettings';

describe('progress-pic privacy setting', () => {
  it('is private when the lifter has no settings row yet', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    expect(await readProgressPicVisibility(db, USER_ID)).toBe('private');
  });

  it('saving writes the choice and exactly one upload line, keeps the unit, and wakes the sync engine', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync((tx) =>
      writeUserSettingsRowTx(tx, { user_id: USER_ID, unit: 'kg', progress_pic_visibility: 'private', updated_at: 't0' }),
    );
    const heard: string[] = [];
    const unsubscribe = onLocalWrite(db, (tbl) => heard.push(tbl));

    await setProgressPicVisibility(db, USER_ID, 'followers', { now: 't1' });

    expect(await readUserSettingsRow(db, USER_ID)).toEqual({
      user_id: USER_ID,
      unit: 'kg',
      progress_pic_visibility: 'followers',
      updated_at: 't1',
    });
    expect(await readProgressPicVisibility(db, USER_ID)).toBe('followers');
    expect((await pendingRows(db, 'user_settings')).map((p) => p.rowId)).toEqual([USER_ID]);
    expect(heard).toEqual(['user_settings']);
    unsubscribe();
  });

  it('a failed save stores and queues nothing', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.execAsync('drop table outbox');
    await expect(setProgressPicVisibility(db, USER_ID, 'public')).rejects.toThrow();
    expect(await readUserSettingsRow(db, USER_ID)).toBeNull();
  });

  it('a choice made offline survives the app dying, then one healed sync lands it once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-b26-'));
    const file = join(dir, 'astra.db');
    try {
      const server = new FakeServer();
      server.seedUserSettings(USER_ID, 'lb');
      server.offline = true;
      const before = await prepareDatabase(createNodeSqliteDriver(file));
      await setProgressPicVisibility(before, USER_ID, 'followers');
      await expect(pushOutbox(before, server)).rejects.toThrow('Network request failed');

      // "Killed": the old connection is abandoned; a new one opens the same file.
      const after = await prepareDatabase(createNodeSqliteDriver(file));
      expect(await readProgressPicVisibility(after, USER_ID)).toBe('followers');
      server.offline = false;
      expect((await pushOutbox(after, server)).userSettings).toBe(1);
      expect(server.userSettings.get(USER_ID)).toMatchObject({ unit: 'lb', progress_pic_visibility: 'followers' });
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
