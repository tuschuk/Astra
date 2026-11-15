/**
 * The hook that keeps the device and server in sync for as long as the app is
 * open. Mounted once, in the root layout.
 *
 * What it does:
 *   - opens the on-device database on launch (which also seeds the exercise
 *     library the first time), signed in or not;
 *   - while someone is signed in, loads their kg/lb choice into the unit store
 *     (B15), then runs a sync engine for them, wired to sync on start, on
 *     returning to the foreground, on reconnecting and after each local
 *     change — and to hand a downloaded settings row back to the unit store;
 *   - on sign-out or account change, stops that engine. The device data is
 *     kept, so signing back in doesn't re-download history over mobile data.
 *
 * Everything it needs comes through `deps`, so tests run it with an
 * in-memory database and a fake server.
 */
import { useEffect } from 'react';

import type { SqlDriver } from '@/db/driver';
import type { UserSettingsRow } from '@/db/userSettings';

import { SyncEngine, type SyncTriggers } from './engine';
import type { SyncTransport } from './transport';

/**
 * The slice of the unit store (settings/unitStore.ts) `useSync` needs: load the signed-in
 * lifter's kg/lb choice, hear about a downloaded one, and forget it on sign-out. Handed in
 * through `deps` so the sync engine and its push/pull code never import the settings code;
 * only this hook's real-app defaults (`defaultDeps`) load the store.
 */
export interface SyncSettingsHooks {
  hydrate: (db: SqlDriver, userId: string) => Promise<void>;
  applyPulled: (row: UserSettingsRow) => void;
  reset: () => void;
}

/** The pieces `useSync` wires together. */
export interface SyncDeps {
  openDatabase: () => Promise<SqlDriver>;
  createTransport: () => SyncTransport;
  triggers: () => SyncTriggers;
  /** The unit store's hooks (B15). Optional: tests that don't care about units leave it out. */
  settings?: SyncSettingsHooks;
}

/** The real pieces: expo-sqlite, Supabase, React Native's AppState and expo-network. */
function defaultDeps(): SyncDeps {
  /* eslint-disable @typescript-eslint/no-require-imports -- loaded lazily so importing this hook in tests never loads native modules */
  const { openAppDatabase } = require('@/db/database') as typeof import('@/db/database');
  const { getSupabase } = require('@/lib/supabase') as typeof import('@/lib/supabase');
  const { createSupabaseTransport } = require('./supabaseTransport') as typeof import('./supabaseTransport');
  const { AppState } = require('react-native') as typeof import('react-native');
  const Network = require('expo-network') as typeof import('expo-network');
  const { unitStore } = require('@/settings/unitStore') as typeof import('@/settings/unitStore');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    openDatabase: openAppDatabase,
    createTransport: () => createSupabaseTransport(getSupabase()),
    triggers: () => ({ appState: AppState, network: Network }),
    settings: { hydrate: unitStore.hydrate, applyPulled: unitStore.applyPulled, reset: unitStore.reset },
  };
}

/**
 * Keeps user `userId`'s data in sync (see the file comment). Pass null when
 * nobody is signed in. Failures to open the database are logged, not thrown —
 * the app still runs, it just can't save offline until the next launch.
 */
export function useSync(userId: string | null, deps?: SyncDeps): void {
  useEffect(() => {
    const d = deps ?? defaultDeps();
    let cancelled = false;
    let stop: (() => void) | null = null;
    // Signed out: back to the default unit, so the next account starts clean.
    if (!userId) d.settings?.reset();

    d.openDatabase()
      .then(async (db) => {
        if (cancelled || !userId) return;
        // Load the lifter's kg/lb choice first, so screens switch to it as early as possible.
        // A failed read only means pounds are shown until the next launch; sync still starts.
        await d.settings?.hydrate(db, userId).catch((error: unknown) => {
          console.warn('Sync: the saved weight unit could not be read', error);
        });
        if (cancelled) return;
        const engine = new SyncEngine({
          db,
          transport: d.createTransport(),
          userId,
          onUserSettingsPulled: d.settings?.applyPulled,
        });
        stop = engine.start(d.triggers());
      })
      .catch((error: unknown) => {
        console.warn('Sync: the on-device database could not be opened', error);
      });

    return () => {
      cancelled = true;
      stop?.();
    };
    // deps is a fixed bundle per mount; re-running on its identity would churn engines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
