/**
 * Tests for the on-device settings row (B15, widened B26 and B47), on real SQLite: read, save,
 * replace, patch one field without touching the others, and reading damaged values back as the
 * defaults.
 */
import { describe, expect, it } from '@jest/globals';

import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { prepareDatabase } from './database';
import {
  parseNotifySwitch,
  parseNotifySwitches,
  parseUnit,
  parseVisibility,
  patchUserSettingsTx,
  readUserSettingsRow,
  settableFields,
  writeUserSettingsRowTx,
  type NotifyField,
  type UserSettingsRow,
} from './userSettings';

/** A whole settings row for user `user_id`, with the given values. */
function row(
  user_id: string,
  unit: 'kg' | 'lb',
  updated_at: string,
  progress_pic_visibility: UserSettingsRow['progress_pic_visibility'] = 'private',
  notify: Partial<Pick<UserSettingsRow, NotifyField>> = {},
): UserSettingsRow {
  return { user_id, unit, progress_pic_visibility, ...ALL_ON, ...notify, updated_at };
}

/** The four B47 switches, all on (the default). */
const ALL_ON = { notify_follows: true, notify_comments: true, notify_votes: true, notify_team_pushes: true };

describe('user settings row', () => {
  it('is absent until saved, then reads back exactly', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    expect(await readUserSettingsRow(db, 'u1')).toBeNull();
    const saved = row('u1', 'kg', '2026-11-15T00:00:00.000Z', 'followers');
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, saved));
    expect(await readUserSettingsRow(db, 'u1')).toEqual(saved);
  });

  it('saving again replaces the one row per user and leaves other users alone', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync(async (tx) => {
      await writeUserSettingsRowTx(tx, row('u1', 'kg', 't1'));
      await writeUserSettingsRowTx(tx, row('u2', 'kg', 't1'));
      await writeUserSettingsRowTx(tx, row('u1', 'lb', 't2', 'public'));
    });
    expect(await readUserSettingsRow(db, 'u1')).toEqual(row('u1', 'lb', 't2', 'public'));
    expect((await readUserSettingsRow(db, 'u2'))?.unit).toBe('kg');
    expect(await db.getFirstAsync('select count(*) as n from user_settings')).toEqual({ n: 2 });
  });

  it('reads anything but "kg" as pounds, the column default', () => {
    expect(parseUnit('kg')).toBe('kg');
    expect(parseUnit('lb')).toBe('lb');
    expect(parseUnit('stone')).toBe('lb');
    expect(parseUnit(null)).toBe('lb');
  });

  it('B26: reads an unknown visibility as private — failing closed, never open', () => {
    expect(parseVisibility('public')).toBe('public');
    expect(parseVisibility('followers')).toBe('followers');
    expect(parseVisibility('private')).toBe('private');
    expect(parseVisibility('everyone')).toBe('private');
    expect(parseVisibility(null)).toBe('private');
  });
});

describe('patchUserSettingsTx (B26)', () => {
  it('with no row yet, starts from the defaults (pounds, private)', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    const saved = await db.withTransactionAsync((tx) => patchUserSettingsTx(tx, 'u1', { unit: 'kg' }, 't1'));
    expect(saved).toEqual(row('u1', 'kg', 't1', 'private'));
    expect(await readUserSettingsRow(db, 'u1')).toEqual(saved);
  });

  it('changing the unit keeps the privacy choice, and changing privacy keeps the unit', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, row('u1', 'lb', 't0', 'followers')));

    await db.withTransactionAsync((tx) => patchUserSettingsTx(tx, 'u1', { unit: 'kg' }, 't1'));
    expect(await readUserSettingsRow(db, 'u1')).toEqual(row('u1', 'kg', 't1', 'followers'));

    await db.withTransactionAsync((tx) => patchUserSettingsTx(tx, 'u1', { progress_pic_visibility: 'public' }, 't2'));
    expect(await readUserSettingsRow(db, 'u1')).toEqual(row('u1', 'kg', 't2', 'public'));
  });

  it('B47: turning one notification switch off changes that column only, and it reads back off', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, row('u1', 'kg', 't0', 'followers')));
    await db.withTransactionAsync((tx) => patchUserSettingsTx(tx, 'u1', { notify_votes: false }, 't1'));
    expect(await readUserSettingsRow(db, 'u1')).toEqual(row('u1', 'kg', 't1', 'followers', { notify_votes: false }));
    expect(await db.getFirstAsync('select notify_votes, notify_comments from user_settings')).toEqual({ notify_votes: 0, notify_comments: 1 });

    // A unit change afterwards keeps the switch off.
    await db.withTransactionAsync((tx) => patchUserSettingsTx(tx, 'u1', { unit: 'lb' }, 't2'));
    expect((await readUserSettingsRow(db, 'u1'))?.notify_votes).toBe(false);
  });
});

describe('notification switches (B47)', () => {
  it('only an explicit off is off — damaged or missing values read as on, the default', () => {
    expect(parseNotifySwitch(false)).toBe(false);
    expect(parseNotifySwitch(0)).toBe(false);
    expect(parseNotifySwitch('0')).toBe(false);
    expect(parseNotifySwitch(true)).toBe(true);
    expect(parseNotifySwitch(1)).toBe(true);
    expect(parseNotifySwitch(null)).toBe(true);
    expect(parseNotifySwitch(undefined)).toBe(true);
    expect(parseNotifySwitch('garbage')).toBe(true);
  });

  it('reads all four from a row, and settableFields carries all six settable fields', () => {
    expect(parseNotifySwitches({ notify_follows: 0, notify_comments: 1, notify_votes: false })).toEqual({
      notify_follows: false,
      notify_comments: true,
      notify_votes: false,
      notify_team_pushes: true,
    });
    const whole = row('u1', 'kg', 't', 'public', { notify_team_pushes: false });
    expect(settableFields(whole)).toEqual({
      unit: 'kg',
      progress_pic_visibility: 'public',
      notify_follows: true,
      notify_comments: true,
      notify_votes: true,
      notify_team_pushes: false,
    });
  });
});
