/**
 * The on-device copy of the lifter's settings row (`user_settings`, schema version 6, B15).
 *
 * Why its own module: `user_settings` is shaped unlike the five training tables — one row per
 * user, keyed by `user_id` rather than `id`, and the server lets the phone UPDATE it but never
 * insert it (the row is created with the account). So it skips the generic table machinery in
 * `dao.ts` and keeps its few lines of SQL here, where both the settings screen's store
 * (`settings/unitStore.ts`) and the sync code (`sync/push.ts`, `sync/pull.ts`) can share them
 * without either reaching into the other.
 *
 * Only the kg/lb `unit` lives here today. Weights themselves are always stored in kg; the unit
 * decides only how they are shown and typed (conversion lives in `@training-math`).
 */
import type { WeightUnit } from '@training-math';

import type { SqlExecutor } from './driver';

/** The settings row, column for column as the device and the server both name them. */
export interface UserSettingsRow {
  user_id: string;
  unit: WeightUnit;
  /** When the row last changed (the phone's clock locally; the server's after a download). */
  updated_at: string;
}

/**
 * Reads a stored unit text back as a unit. Anything that isn't exactly "kg" is treated as
 * pounds, the column's default — the server's CHECK only ever lets 'kg' or 'lb' in, so this
 * only guards against a damaged local file.
 */
export function parseUnit(value: unknown): WeightUnit {
  return value === 'kg' ? 'kg' : 'lb';
}

/** Reads user `userId`'s settings row from the phone, or null if none is stored yet. */
export async function readUserSettingsRow(db: SqlExecutor, userId: string): Promise<UserSettingsRow | null> {
  const row = await db.getFirstAsync<{ user_id: string; unit: string; updated_at: string }>(
    'select user_id, unit, updated_at from user_settings where user_id = ?',
    [userId],
  );
  return row ? { user_id: row.user_id, unit: parseUnit(row.unit), updated_at: row.updated_at } : null;
}

/**
 * Saves a settings row (insert, or replace the values of the row with the same `user_id`),
 * inside an already-open transaction. Does not queue anything for upload — the caller decides
 * that: a change the lifter made also adds an outbox line (see `unitStore.setUnit`); a row
 * downloaded from the server does not.
 */
export async function writeUserSettingsRowTx(tx: SqlExecutor, row: UserSettingsRow): Promise<void> {
  await tx.runAsync(
    'insert into user_settings (user_id, unit, updated_at) values (?, ?, ?) ' +
      'on conflict (user_id) do update set unit = excluded.unit, updated_at = excluded.updated_at',
    [row.user_id, row.unit, row.updated_at],
  );
}
