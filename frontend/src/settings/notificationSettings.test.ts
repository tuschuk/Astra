/**
 * Tests for the five push-notification switches on the phone (B47, B48's messages), on real SQLite: all on by
 * default, flipping one changes exactly that one (and nothing else) with one upload line in the
 * same transaction, a failed save stores nothing, and an offline flip survives the app dying and
 * reaches the (fake) server exactly once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { prepareDatabase } from '@/db/database';
import { onLocalWrite } from '@/db/dao';
import { DEFAULT_USER_SETTINGS, NOTIFY_FIELDS, readUserSettingsRow, writeUserSettingsRowTx } from '@/db/userSettings';
import { pendingRows } from '@/sync/outbox';
import { pushOutbox } from '@/sync/push';
import { FakeServer } from '@/test-utils/fakeTransport';
import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';
import { USER_ID } from '@/test-utils/workoutFixtures';

import { readNotificationSwitches, setNotificationSwitch } from './notificationSettings';

const ALL_ON = { notify_follows: true, notify_comments: true, notify_votes: true, notify_team_pushes: true, notify_messages: true };

describe('notification switches', () => {
  it('are all on when the lifter has no settings row yet', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    expect(await readNotificationSwitches(db, USER_ID)).toEqual(ALL_ON);
  });

  for (const field of NOTIFY_FIELDS) {
    it(`turning ${field} off changes exactly that switch, keeps every other setting, and queues one upload`, async () => {
      const db = await prepareDatabase(createNodeSqliteDriver());
      await db.withTransactionAsync((tx) =>
        writeUserSettingsRowTx(tx, { ...DEFAULT_USER_SETTINGS, user_id: USER_ID, unit: 'kg', progress_pic_visibility: 'followers', updated_at: 't0' }),
      );
      const heard: string[] = [];
      const unsubscribe = onLocalWrite(db, (tbl) => heard.push(tbl));

      await setNotificationSwitch(db, USER_ID, field, false, { now: 't1' });

      expect(await readNotificationSwitches(db, USER_ID)).toEqual({ ...ALL_ON, [field]: false });
      expect(await readUserSettingsRow(db, USER_ID)).toMatchObject({ unit: 'kg', progress_pic_visibility: 'followers', updated_at: 't1' });
      expect((await pendingRows(db, 'user_settings')).map((p) => p.rowId)).toEqual([USER_ID]);
      expect(heard).toEqual(['user_settings']);
      unsubscribe();

      await setNotificationSwitch(db, USER_ID, field, true);
      expect(await readNotificationSwitches(db, USER_ID)).toEqual(ALL_ON);
    });
  }

  it('a failed save stores and queues nothing', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.execAsync('drop table outbox');
    await expect(setNotificationSwitch(db, USER_ID, 'notify_votes', false)).rejects.toThrow();
    expect(await readUserSettingsRow(db, USER_ID)).toBeNull();
  });

  it('a switch turned off offline survives the app dying, then one healed sync lands it once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'astra-b47-'));
    const file = join(dir, 'astra.db');
    try {
      const server = new FakeServer();
      server.seedUserSettings(USER_ID, 'lb');
      server.offline = true;
      const before = await prepareDatabase(createNodeSqliteDriver(file));
      await setNotificationSwitch(before, USER_ID, 'notify_team_pushes', false);
      await expect(pushOutbox(before, server)).rejects.toThrow('Network request failed');

      const after = await prepareDatabase(createNodeSqliteDriver(file));
      expect((await readNotificationSwitches(after, USER_ID)).notify_team_pushes).toBe(false);
      server.offline = false;
      expect((await pushOutbox(after, server)).userSettings).toBe(1);
      expect(server.userSettings.get(USER_ID)).toMatchObject({ ...ALL_ON, notify_team_pushes: false, unit: 'lb' });
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
