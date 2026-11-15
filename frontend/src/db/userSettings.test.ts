/**
 * Tests for the on-device settings row (B15), on real SQLite: read, save, replace, and reading
 * a damaged unit back as the default.
 */
import { describe, expect, it } from '@jest/globals';

import { createNodeSqliteDriver } from '@/test-utils/nodeSqliteDriver';

import { prepareDatabase } from './database';
import { parseUnit, readUserSettingsRow, writeUserSettingsRowTx } from './userSettings';

describe('user settings row', () => {
  it('is absent until saved, then reads back exactly', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    expect(await readUserSettingsRow(db, 'u1')).toBeNull();
    const row = { user_id: 'u1', unit: 'kg' as const, updated_at: '2026-11-15T00:00:00.000Z' };
    await db.withTransactionAsync((tx) => writeUserSettingsRowTx(tx, row));
    expect(await readUserSettingsRow(db, 'u1')).toEqual(row);
  });

  it('saving again replaces the one row per user and leaves other users alone', async () => {
    const db = await prepareDatabase(createNodeSqliteDriver());
    await db.withTransactionAsync(async (tx) => {
      await writeUserSettingsRowTx(tx, { user_id: 'u1', unit: 'kg', updated_at: 't1' });
      await writeUserSettingsRowTx(tx, { user_id: 'u2', unit: 'kg', updated_at: 't1' });
      await writeUserSettingsRowTx(tx, { user_id: 'u1', unit: 'lb', updated_at: 't2' });
    });
    expect(await readUserSettingsRow(db, 'u1')).toEqual({ user_id: 'u1', unit: 'lb', updated_at: 't2' });
    expect((await readUserSettingsRow(db, 'u2'))?.unit).toBe('kg');
    expect(await db.getFirstAsync('select count(*) as n from user_settings')).toEqual({ n: 2 });
  });

  it('reads anything but "kg" as pounds, the column default', () => {
    expect(parseUnit('kg')).toBe('kg');
    expect(parseUnit('lb')).toBe('lb');
    expect(parseUnit('stone')).toBe('lb');
    expect(parseUnit(null)).toBe('lb');
  });
});
