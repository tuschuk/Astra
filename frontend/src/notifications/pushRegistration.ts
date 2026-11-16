/**
 * Push registration (B47): getting this phone's Expo push token to the server, so the `notify`
 * server function knows where to send a lifter's notifications — and taking it back on sign-out.
 *
 * What a push token is: Expo's address for one install of Astra on one phone. The phone asks the
 * operating system for permission to show notifications, then asks Expo for the token, then saves
 * it to the server's `push_tokens` table through `register_push_token` (which also moves a token
 * from whoever used this phone before to whoever is signed in now).
 *
 * When it runs:
 *   - `register(userId, { ask: true })` — when the lifter taps "Turn on push notifications" in
 *     Settings, or once after their first Post (`askOnce.ts`). This is the only path that can show
 *     the operating system's permission prompt;
 *   - `register(userId, { ask: false })` — on every app start while signed in. If permission was
 *     already given it re-saves the token (keeping it fresh); if not, it does nothing and never
 *     prompts. Astra never asks on launch;
 *   - `watchTokenChanges(userId)` — when Expo hands the phone a new token, save that one too;
 *   - `unregister()` — on sign-out, best effort: forget this phone on the server so the next
 *     person to use it doesn't get the previous lifter's notifications. Never blocks sign-out.
 *
 * Why it never crashes and often says "unavailable": `expo-notifications` is loaded lazily and
 * guarded (the `toolkit/timerAlerts.ts` pattern, deliberately a separate small copy — plan
 * decision 10), and three things can be missing — the module (Expo Go on Android has no remote
 * push), the permission, or the Expo project id that tokens need (set by `npx eas init`, which
 * Tristen runs). Each turns into a quiet answer the Settings screen can explain; the notification
 * switches work regardless, because they are server settings.
 *
 * Token saves are online-only on purpose: a token is this phone's address on the server, not
 * training data, and a failed save simply happens again on the next app start.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabase } from '@/lib/supabase';

/** The shape of `expo-notifications`, for the guarded loader and its fakes. */
export type NotificationsModule = typeof import('expo-notifications');

/** Where push stands on this phone. */
export type PushState =
  /** Permission given and this phone's token is saved for the signed-in lifter. */
  | 'on'
  /** Permission not given yet; asking is still possible. */
  | 'off'
  /** The lifter refused permission and the phone won't let Astra ask again (only phone Settings can undo it). */
  | 'denied'
  /** Push can't work on this build: no notification module, no Expo project id, or not iOS/Android. */
  | 'unavailable'
  /** Everything was in place but the token couldn't be fetched or saved (often: no signal). Try again later. */
  | 'failed';

/** The server half: saving and forgetting a token. Tests pass a fake. */
export interface PushTokenServer {
  /** Saves `token` for the signed-in lifter (the `register_push_token` RPC). Throws on failure. */
  register(token: string, platform: 'ios' | 'android', deviceName: string | null): Promise<void>;
  /** Deletes this token's row (the lifter's own rows only — row-level security). Throws on failure. */
  remove(token: string): Promise<void>;
}

/** What the Settings screen, the app start and sign-out need from push. */
export interface PushRegistrationPort {
  /**
   * Gets and saves this phone's token for `userId` and answers where push now stands. Prompts
   * only when `ask` is true; with `ask: false` it doubles as the no-prompt status check Settings
   * runs each time it opens.
   */
  register(userId: string, options: { ask: boolean }): Promise<PushState>;
  /** Saves each new token Expo hands this phone while `userId` is signed in; returns a stop function. */
  watchTokenChanges(userId: string): () => void;
  /** Forgets this phone on the server, best effort, within `timeoutMs`. Never throws. */
  unregister(timeoutMs?: number): Promise<void>;
}

/** The Android notification channel social pushes arrive on (Android drops pushes without one). */
export const PUSH_CHANNEL_ID = 'default';

/** How long sign-out waits for the server to forget this phone before carrying on regardless. */
export const UNREGISTER_TIMEOUT_MS = 3000;

/**
 * Loads `expo-notifications` on first use, or null if it can't be loaded — so a broken or missing
 * native module can never take Settings or the app start down with it.
 */
export function loadPushNotificationsModule(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily and guarded so a broken native module can't crash the app
    return require('expo-notifications') as NotificationsModule;
  } catch (caught) {
    console.warn('Push: notifications are unavailable on this build', caught);
    return null;
  }
}

/** The Expo project id push tokens are issued for, from `app.json` (`extra.eas.projectId`), or null. */
export function expoProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const fromEas = (Constants as { easConfig?: { projectId?: unknown } }).easConfig?.projectId;
  const id = fromExtra ?? fromEas;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * True when this is Expo Go on Android, where remote push is not supported at all (SDK 53+): the
 * module loads, but fetching a token always fails. Treated as "unavailable" up front, so Settings
 * explains it calmly instead of offering a "Try again" that can never work.
 */
export function isExpoGoOnAndroid(platform: string = Platform.OS): boolean {
  return platform === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/** What the port is built from — the real phone in the app, fakes in tests. */
interface PushRegistrationOptions {
  /** Supplies `expo-notifications`, or null when there isn't a usable one. */
  load: () => NotificationsModule | null;
  /** The Expo project id tokens are issued for, or null if the app hasn't got one yet. */
  projectId: () => string | null;
  /** 'ios' or 'android' (anything else is unavailable). */
  platform: string;
  /** False when this build can't receive remote push at all (Expo Go on Android). */
  remotePushSupported: () => boolean;
  /** The phone's name, saved beside its token so a lifter can tell their devices apart. */
  deviceName: () => string | null;
  /** Saves and forgets tokens on the server. */
  server: PushTokenServer;
}

/**
 * Builds the port over a notifications module and a server. It remembers the last token it saved
 * during this app session, so sign-out can forget exactly that one.
 */
export function createPushRegistration({
  load,
  projectId,
  platform,
  remotePushSupported,
  deviceName,
  server,
}: PushRegistrationOptions): PushRegistrationPort {
  let loaded: NotificationsModule | null | undefined;
  let channelReady = false;
  let savedToken: string | null = null;
  // The signed-in lifter the last successful save was for; a token change saves for them only.
  let savedFor: string | null = null;

  /** The notifications module, loaded on first use and remembered (null if it can't load). */
  const notifications = (): NotificationsModule | null => {
    if (loaded === undefined) loaded = load();
    return loaded;
  };
  const os = platform === 'ios' || platform === 'android' ? platform : null;

  /** The module and project id, or null if push can't work on this build. */
  function prerequisites(): { module: NotificationsModule; id: string; os: 'ios' | 'android' } | null {
    // The cheap checks first, so the native module is never even loaded when push can't work.
    const id = projectId();
    if (!id || !os || !remotePushSupported()) return null;
    const module = notifications();
    return module ? { module, id, os } : null;
  }

  /** Reads the permission without asking; maps it to on-able / off / denied. */
  async function permission(module: NotificationsModule): Promise<'granted' | 'off' | 'denied'> {
    const current = await module.getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain ? 'off' : 'denied';
  }

  /** Fetches the token and saves it for `userId`. */
  async function save(module: NotificationsModule, id: string, system: 'ios' | 'android', userId: string): Promise<PushState> {
    try {
      if (system === 'android' && !channelReady) {
        await module.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
          name: 'Activity',
          importance: module.AndroidImportance.DEFAULT,
        });
        channelReady = true;
      }
      const { data: token } = await module.getExpoPushTokenAsync({ projectId: id });
      await server.register(token, system, deviceName());
      savedToken = token;
      savedFor = userId;
      return 'on';
    } catch (caught) {
      console.warn('Push: could not register this phone', caught);
      return 'failed';
    }
  }

  return {
    async register(userId, { ask }) {
      const ready = prerequisites();
      if (!ready) return 'unavailable';
      const { module, id, os: system } = ready;
      try {
        let state = await permission(module);
        if (state === 'off' && ask) {
          const asked = await module.requestPermissionsAsync();
          state = asked.granted ? 'granted' : asked.canAskAgain ? 'off' : 'denied';
        }
        if (state !== 'granted') return state;
      } catch (caught) {
        console.warn('Push: could not read or ask the permission', caught);
        return 'unavailable';
      }
      return save(module, id, system, userId);
    },

    watchTokenChanges(userId) {
      const ready = prerequisites();
      if (!ready) return () => {};
      try {
        const subscription = ready.module.addPushTokenListener(() => {
          // The listener hands over the phone's raw token; the Expo token is fetched afresh.
          if (savedFor === userId) void save(ready.module, ready.id, ready.os, userId);
        });
        return () => subscription.remove();
      } catch (caught) {
        console.warn('Push: could not watch for token changes', caught);
        return () => {};
      }
    },

    async unregister(timeoutMs = UNREGISTER_TIMEOUT_MS) {
      const token = savedToken;
      savedToken = null;
      savedFor = null;
      if (!token) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          server.remove(token),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
          }),
        ]);
      } catch (caught) {
        // Offline, most likely. The row is cleaned up by the next account's registration on this
        // phone, or by Expo reporting the token dead.
        console.warn('Push: could not forget this phone on the server', caught);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

/** The app's push port: the real module, `app.json`'s project id, and the Supabase server half. */
export const pushRegistration: PushRegistrationPort = createPushRegistration({
  load: loadPushNotificationsModule,
  projectId: expoProjectId,
  platform: Platform.OS,
  remotePushSupported: () => !isExpoGoOnAndroid(),
  deviceName: () => Constants.deviceName ?? null,
  server: supabasePushTokenServer(getSupabase),
});

/** The server half over the app's Supabase client. */
export function supabasePushTokenServer(client: () => SupabaseClient): PushTokenServer {
  return {
    async register(token, platform, deviceName) {
      const { error } = await client().rpc('register_push_token', {
        p_token: token,
        p_platform: platform,
        p_device_name: deviceName,
      });
      if (error) throw new Error(`Saving the push token failed: ${error.message}`);
    },
    async remove(token) {
      const { error } = await client().from('push_tokens').delete().eq('token', token);
      if (error) throw new Error(`Forgetting the push token failed: ${error.message}`);
    },
  };
}
