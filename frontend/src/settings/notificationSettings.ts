/**
 * The lifter's four push-notification switches on the phone (B47, the Notifications section of
 * Settings — YOU-4): push me when someone follows me, comments on my post, upvotes my post, or
 * posts to one of my Teams. Each is on until the lifter turns it off.
 *
 * Where they take effect: the server's `notify` function reads the server's copy of these
 * switches each time it decides whether to send a push, so turning one off stops exactly that
 * kind of notification — and only that kind. The phone's copy is what Settings shows.
 *
 * How a change is saved — exactly like the kg/lb toggle and the progress-pic choice: the phone's
 * `user_settings` row (with every other setting left as it was) and its upload line are written in
 * ONE transaction, so it works with no signal, survives the app being killed, and reaches the
 * server on reconnect. Until then the server still has the old value — the same honesty as every
 * other setting.
 */
import { notifyLocalWrite } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import {
  DEFAULT_USER_SETTINGS,
  NOTIFY_FIELDS,
  patchUserSettingsTx,
  readUserSettingsRow,
  type NotifyField,
} from '@/db/userSettings';
import { enqueueTx } from '@/sync/outbox';

export type { NotifyField };

/** The four switches, on (true) or off (false). */
export type NotificationSwitches = Record<NotifyField, boolean>;

/**
 * User `userId`'s four switches, read from the phone. With no settings row yet (a brand-new
 * install before the first download) every switch is on, the same as the server's default.
 */
export async function readNotificationSwitches(db: SqlExecutor, userId: string): Promise<NotificationSwitches> {
  const row = (await readUserSettingsRow(db, userId)) ?? DEFAULT_USER_SETTINGS;
  return Object.fromEntries(NOTIFY_FIELDS.map((field) => [field, row[field]])) as NotificationSwitches;
}

/**
 * Turns one switch on or off, offline-safe: changes only that one column of the phone's settings
 * row, queues the upload in the same transaction, then wakes the sync engine. Throws if the
 * phone's database refuses the write (nothing is saved or queued then).
 */
export async function setNotificationSwitch(
  db: SqlDriver,
  userId: string,
  field: NotifyField,
  on: boolean,
  options: { now?: string } = {},
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  await db.withTransactionAsync(async (tx) => {
    await patchUserSettingsTx(tx, userId, { [field]: on }, now);
    // The outbox line's row id is the user id: that is the settings table's key.
    await enqueueTx(tx, 'user_settings', userId, now);
  });
  notifyLocalWrite(db, ['user_settings']);
}
