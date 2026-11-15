/**
 * `wipeDeviceData` — clears everything Astra keeps on this phone, right after the server has
 * deleted the lifter's account (B32, NFR-6 — "after deletion nothing of the user remains").
 *
 * Why it exists: deleting the account on the server removes it everywhere it is stored online,
 * but this phone still holds its own copy — the workout database, saved preferences, and photos
 * that were waiting to upload. Those belong to an account that no longer exists, so they go too.
 *
 * The steps, in order:
 *   1. sign out of this device — drops the now-dead login and sends the app to the sign-in
 *      screen (which also stops the sync engine);
 *   2. close the app's database and delete its file (`astra.db`), with nothing able to reopen
 *      it in between (see `deleteAppDatabase`);
 *   3. clear the small key-value store (plate rack, feed preferences, the cached own profile;
 *      the login was already removed in step 1);
 *   4. delete the folder of photos still waiting to upload.
 *
 * Every step is best-effort: a failure is logged and the next step still runs. The account is
 * already gone by now, so nothing here may stand between the lifter and the sign-in screen.
 * Only ever run this after the server answered that the account was deleted.
 */
import * as FileSystem from 'expo-file-system/legacy';
import KeyValueStore from 'expo-sqlite/kv-store';

import { localPostImagesFolder } from '@/social/postImages';

import { deleteAppDatabase } from './database';

/** The phone-side clean-up steps after sign-out, injectable so tests can watch and break them. */
export interface WipeSteps {
  /** Closes the app database and deletes its file. */
  deleteDatabase(): Promise<void>;
  /** Empties the key-value store. */
  clearKeyValueStore(): Promise<void>;
  /** Deletes the folder of photos waiting to upload (a missing folder is no error). */
  deleteWaitingPhotos(): Promise<void>;
}

/** The real phone's clean-up. */
export const deviceWipeSteps: WipeSteps = {
  deleteDatabase: deleteAppDatabase,
  clearKeyValueStore: () => KeyValueStore.clear(),
  deleteWaitingPhotos: () => FileSystem.deleteAsync(localPostImagesFolder(), { idempotent: true }),
};

/** What the auth provider's sign-out answers: it reports failure rather than throwing. */
export type SignOutAnswer = { ok: boolean };

/**
 * Runs the wipe (see the file comment). `signOut` is the auth provider's sign-out. Resolves
 * once every step has been tried, with whether this device actually signed out (if not, the
 * screen tells the lifter to close and reopen the app); never throws.
 */
export async function wipeDeviceData(
  signOut: () => Promise<SignOutAnswer>,
  steps: WipeSteps = deviceWipeSteps,
): Promise<{ signedOut: boolean }> {
  /** Runs one step, logging (not throwing) a failure; true if it worked. */
  const attempt = async (what: string, step: () => Promise<unknown>): Promise<boolean> => {
    try {
      await step();
      return true;
    } catch (error: unknown) {
      console.warn(`Device wipe: ${what} failed`, error);
      return false;
    }
  };
  const signedOut = await attempt('sign-out', async () => {
    const answer = await signOut();
    if (!answer.ok) throw new Error('the sign-out was refused');
  });
  await attempt('deleting the database', steps.deleteDatabase);
  await attempt('clearing saved preferences', steps.clearKeyValueStore);
  await attempt('deleting waiting photos', steps.deleteWaitingPhotos);
  return { signedOut };
}
