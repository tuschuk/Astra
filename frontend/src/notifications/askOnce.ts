/**
 * The one-time push ask after the lifter's first Post (B47, plan decision 9).
 *
 * Why here: the moment someone has just shared something is the moment notifications become
 * worth having — people are about to follow, comment and upvote. So right after the first
 * successful Post (a workout post or a photo post) Astra asks the phone for permission, once in
 * the app's life on this phone. It never asks on launch, and never asks twice: a flag in the
 * phone's key-value store remembers that the ask happened, whatever the lifter answered. (A phone
 * that already gave permission isn't prompted again by the system; the call just saves the token.)
 * (Settings
 * → Notifications can always ask again with "Turn on push notifications".)
 *
 * Never throws and is never waited on by the Post flow — posting must not depend on it.
 */
import KeyValueStore from 'expo-sqlite/kv-store';

import { pushRegistration, type PushRegistrationPort } from './pushRegistration';

/** The key-value store key that records the ask has happened on this phone. */
export const ASKED_AFTER_POST_KEY = 'astra.push.askedAfterFirstPost';

/** The slice of the key-value store this file uses — swappable in tests. */
export interface AskOnceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Asks for push permission (and saves this phone's token) the first time it is called on this
 * phone; does nothing on every later call. The one exception: if push can't work on this build
 * at all ('unavailable' — no Expo project id yet, or Expo Go on Android) no prompt could have been
 * shown, so the ask is NOT used up; the next Post after push becomes possible gets it.
 */
export async function maybeAskForPushOnce(
  userId: string,
  port: PushRegistrationPort = pushRegistration,
  storage: AskOnceStorage = KeyValueStore,
): Promise<void> {
  try {
    if ((await storage.getItem(ASKED_AFTER_POST_KEY)) != null) return;
    const state = await port.register(userId, { ask: true });
    if (state !== 'unavailable') await storage.setItem(ASKED_AFTER_POST_KEY, '1');
  } catch (caught) {
    console.warn('Push: the after-post ask did not run', caught);
  }
}
