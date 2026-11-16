/**
 * `usePushNotifications` — the app-wide half of push (B47), mounted once in the root layout.
 *
 * While a lifter is signed in and the app is ready, it:
 *   1. saves this phone's push token again if permission was ALREADY given (never prompts — Astra
 *      never asks on launch; the asks live in Settings and after the first Post);
 *   2. keeps saving the token when Expo hands the phone a new one;
 *   3. opens the right screen when the lifter taps a notification — including the tap that
 *      launched the app from closed — after checking the screen is one a push may open
 *      (`notificationNav.ts`).
 * With no usable notification module (Expo Go on Android, or under Jest) it does nothing.
 */
import { useEffect } from 'react';
import type { Href } from 'expo-router';

import { pushTargetPath } from './notificationNav';
import {
  loadPushNotificationsModule,
  pushRegistration,
  type NotificationsModule,
  type PushRegistrationPort,
} from './pushRegistration';

/** What the hook needs (see `usePushNotifications`). */
interface Options {
  /** The signed-in lifter, or null when signed out (nothing runs then). */
  userId: string | null;
  /** True once the navigator is mounted, so a tap can be followed. */
  ready: boolean;
  /** Opens a screen (the router's push). */
  navigate: (path: Href) => void;
  /** Injectable for tests. */
  port?: PushRegistrationPort;
  load?: () => NotificationsModule | null;
}

/**
 * Wires push for the signed-in lifter (see the file comment for the three jobs). Inputs: who is
 * signed in (`userId`, null when signed out), whether the navigator can take a navigation yet
 * (`ready`), and how to open a screen (`navigate`). Returns nothing; it only starts and stops
 * listeners as the sign-in changes.
 */
export function usePushNotifications({ userId, ready, navigate, port = pushRegistration, load = loadPushNotificationsModule }: Options): void {
  // 1 + 2: silent registration and token refresh, per signed-in lifter.
  useEffect(() => {
    if (!userId) return;
    void port.register(userId, { ask: false });
    return port.watchTokenChanges(userId);
  }, [userId, port]);

  // 3: taps. A tap that launched the app is read once; later taps arrive through the listener.
  useEffect(() => {
    if (!userId || !ready) return;
    const module = load();
    if (!module) return;
    const handled = new Set<string>();
    // Opens the screen one tapped notification is about — once per notification, and only if
    // its path is one a push may open.
    const follow = (response: { notification: { request: { identifier: string; content: { data?: unknown } } } } | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handled.has(id)) return;
      handled.add(id);
      const path = pushTargetPath(response.notification.request.content.data);
      if (path) navigate(path as Href);
    };
    let live = true;
    let subscription: { remove(): void } | null = null;
    try {
      subscription = module.addNotificationResponseReceivedListener(follow);
      module
        .getLastNotificationResponseAsync()
        .then(async (last) => {
          if (!live || !last) return;
          follow(last);
          // Forget it, so a later sign-in on this phone doesn't re-open an old notification.
          await module.clearLastNotificationResponseAsync();
        })
        .catch((caught: unknown) => console.warn('Push: could not read the tap that opened the app', caught));
    } catch (caught) {
      console.warn('Push: could not listen for notification taps', caught);
    }
    return () => {
      live = false;
      subscription?.remove();
    };
  }, [userId, ready, navigate, load]);
}
