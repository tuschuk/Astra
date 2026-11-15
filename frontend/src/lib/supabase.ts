/**
 * The app's connection to Supabase (accounts, and later every synced table).
 *
 * Why this file exists: one place builds the Supabase client with the
 * settings a phone app needs — the signed-in session is saved on the device
 * (expo-sqlite's key-value store) so the user stays signed in after the app is killed, and the
 * access token is refreshed only while the app is in the foreground.
 *
 * Configuration comes from two environment variables baked in at build time
 * (see `frontend/.env.example`):
 *   EXPO_PUBLIC_SUPABASE_URL       — the project's API address
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY  — the publishable key (safe in an app;
 *                                    row-level security is the real lock)
 *
 * Tests never call `getSupabase()`; they hand a fake client to AuthProvider.
 */
import 'react-native-url-polyfill/auto';
// expo-sqlite's key-value store, a drop-in for AsyncStorage: the session lives
// in SQLite like the rest of the app's device data — one storage engine.
import SessionStorage from 'expo-sqlite/kv-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

/** The two values needed to reach the Supabase project. */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Reads and checks the Supabase settings.
 *
 * Input: an environment map (defaults to the real build-time variables).
 * Output: the URL and key, or a thrown error naming exactly what's missing —
 * far easier to diagnose than a blank screen and a silent 401.
 */
export function readSupabaseConfig(
  env: Record<string, string | undefined> = {
    // Written out literally: Expo only inlines EXPO_PUBLIC_* variables
    // referenced as `process.env.NAME`, never through a dynamic lookup.
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
): SupabaseConfig {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const missing = [
    !url && 'EXPO_PUBLIC_SUPABASE_URL',
    !anonKey && 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean);
  if (!url || !anonKey) {
    throw new Error(
      `Supabase is not configured: set ${missing.join(' and ')} in frontend/.env (see frontend/.env.example), then restart Expo.`,
    );
  }
  return { url, anonKey };
}

/**
 * Builds a Supabase client with the phone-app auth settings:
 * session saved in the SQLite key-value store, tokens auto-refreshed, and no attempt to
 * read a session out of a web URL (there are no web sign-in links here).
 */
export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      storage: SessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

let singleton: SupabaseClient | null = null;

/**
 * The app's one shared Supabase client, created on first use (so merely
 * importing this file never needs the environment variables).
 */
export function getSupabase(): SupabaseClient {
  if (!singleton) {
    singleton = createSupabaseClient(readSupabaseConfig());
  }
  return singleton;
}

/** The slice of the client's auth API that foreground-refresh needs. */
export interface AutoRefreshControls {
  startAutoRefresh: () => Promise<void> | void;
  stopAutoRefresh: () => Promise<void> | void;
}

/** The slice of React Native's AppState used here (injectable for tests). */
export interface AppStateLike {
  currentState: string | null | undefined;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove: () => void };
}

/**
 * Keeps the access token fresh only while the app is open on screen.
 *
 * Why: a phone app shouldn't run a refresh timer in the background, but the
 * moment the user returns, the token must be refreshed so their next request
 * isn't rejected. Supabase's React Native guide recommends exactly this.
 * Returns a function that stops listening (called when the app shell unmounts).
 */
export function refreshWhileForegrounded(
  auth: AutoRefreshControls,
  appState: AppStateLike = AppState,
): () => void {
  const apply = (state: string | null | undefined) => {
    if (state === 'active') {
      void auth.startAutoRefresh();
    } else {
      void auth.stopAutoRefresh();
    }
  };
  apply(appState.currentState);
  const subscription = appState.addEventListener('change', apply);
  return () => {
    subscription.remove();
    void auth.stopAutoRefresh();
  };
}
