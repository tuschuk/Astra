/**
 * The lifter's privacy settings on the phone (B26, the Privacy section of Settings — YOU-4,
 * NFR-5).
 *
 * One choice lives here today: who a NEW progress pic is shown to — only the lifter
 * ('private', the default), their followers, or anyone on Astra. It is the starting value for
 * each progress pic posted afterwards (`social/createPost.ts` reads it); posts already made keep
 * their own visibility, which is changed on the post itself (`social/postPrivacy.ts`).
 *
 * Why it is stored on the phone and not just on the server: a progress pic can be posted with no
 * signal, and it needs to know its visibility right then. So the choice is saved in the phone's
 * `user_settings` row and queued for upload in one transaction — exactly how the kg/lb toggle is
 * saved — and the sync engine carries it to the server's `user_settings.progress_pic_visibility`.
 * Whatever is chosen, who can actually see a post is decided by the server's row-level security,
 * never by the app.
 *
 * No in-memory store (unlike the unit): only the Settings screen and the posting code read this,
 * and both read it fresh from the phone when they need it.
 */
import { notifyLocalWrite, type WorkoutVisibility } from '@/db/dao';
import type { SqlDriver, SqlExecutor } from '@/db/driver';
import { DEFAULT_USER_SETTINGS, patchUserSettingsTx, readUserSettingsRow } from '@/db/userSettings';
import { enqueueTx } from '@/sync/outbox';

/**
 * Who user `userId`'s new progress pics are shown to, read from the phone. With no settings row
 * yet (a brand-new install before the first download) it is 'private' — the safe default, the
 * same as the server's.
 */
export async function readProgressPicVisibility(db: SqlExecutor, userId: string): Promise<WorkoutVisibility> {
  const row = await readUserSettingsRow(db, userId);
  return row?.progress_pic_visibility ?? DEFAULT_USER_SETTINGS.progress_pic_visibility;
}

/**
 * Saves the lifter's choice of who sees their new progress pics, works with no signal: the row
 * (with the kg/lb unit left exactly as it was) and its upload line are written in ONE
 * transaction, so the choice survives the app being killed and reaches the server on reconnect.
 * Then it wakes the sync engine. Throws if the phone's database refuses the write (nothing is
 * saved or queued then).
 */
export async function setProgressPicVisibility(
  db: SqlDriver,
  userId: string,
  visibility: WorkoutVisibility,
  options: { now?: string } = {},
): Promise<void> {
  const now = options.now ?? new Date().toISOString();
  await db.withTransactionAsync(async (tx) => {
    await patchUserSettingsTx(tx, userId, { progress_pic_visibility: visibility }, now);
    // The outbox line's row id is the user id: that is the settings table's key.
    await enqueueTx(tx, 'user_settings', userId, now);
  });
  notifyLocalWrite(db, ['user_settings']);
}
