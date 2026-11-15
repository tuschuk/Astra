/**
 * Tests for the on-device settings row (B15, widened B26), on real SQLite: read, save, replace,
 * patch one field without touching the other, and reading damaged values back as the defaults.
 */
import { describe, expect, it } from '@jest/globals';

import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { prepareDatabase } from './database';
import {
  parseUnit,
  parseVisibility,
  patchUserSettingsTx,
  readUserSettingsRow,
  writeUserSettingsRowTx,
  type UserSettingsRow,
} from './userSettings';

/** A whole settings row for user `user_id`, with the given values. */
function row(user_id: string, unit: 'kg' | 'lb', updated_at: string, progress_pic_visibility: UserSettingsRow['progress_pic_visibility'] = 'private'): UserSettingsRow {
  return { user_id, unit, progress_pic_visibility, updated_at };
}

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
});
