/**
 * "Who can message you" on the phone (B48 — direct messages, SOC-12; the Privacy section of
 * Settings).
 *
 * Two choices: anyone on Astra may start a conversation with the lifter (the default), or only
 * lifters they follow who also follow them back ("mutual follows").
 *
 * Where it takes effect: ONLY on the server. The server's `private.can_message` rule reads the
 * server's copy every time someone tries to start a conversation, and refuses the attempt there.
 * The phone's copy exists so Settings shows the choice and can change it with no signal — saved
 * exactly like the kg/lb toggle and the progress-pic choice: the phone's row and its upload line
 * in ONE transaction, carried to the server by the sync engine on reconnect. Until that upload
 * lands, the server still applies the old choice.
 *
 * What it does not do: close conversations that already exist. Once a conversation has started,
 * both people can keep writing in it; the way to stop an unwanted one is to block the person.
 */
import { notifyLocalWrite } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { DEFAULT_USER_SETTINGS, patchUserSettingsTx, readUserSettingsRow, type DmPolicy } from '@/db/userSettings';
import { enqueueTx } from '@/sync/outbox';

export type { DmPolicy };

/**
 * User `userId`'s "who can message you" choice, read from the phone. With no settings row yet (a
 * brand-new install before the first download) it is 'anyone', the server's default.
 */
export async function readDmPolicy(db: SqlExecutor, userId: string): Promise<DmPolicy> {
  const row = await readUserSettingsRow(db, userId);
  return row?.dm_policy ?? DEFAULT_USER_SETTINGS.dm_policy;
}

/**
 * Saves the lifter's "who can message you" choice, works with no signal: changes only that one
 * column of the phone's settings row, queues the upload in the same transaction, then wakes the
 * sync engine. Throws if the phone's database refuses the write (nothing is saved or queued then).
 */
export async function setDmPolicy(
  db: SqlDriver,
  userId: string,
  policy: DmPolicy,
  options: { now?: string } = {},
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  await db.withTransactionAsync(async (tx) => {
    await patchUserSettingsTx(tx, userId, { dm_policy: policy }, now);
    // The outbox line's row id is the user id: that is the settings table's key.
    await enqueueTx(tx, 'user_settings', userId, now);
  });
  notifyLocalWrite(db, ['user_settings']);
}
