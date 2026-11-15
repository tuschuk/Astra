/**
 * The hook that keeps the device and server in sync for as long as the app is
 * open. Mounted once, in the root layout.
 *
 * What it does:
 *   - opens the on-device database on launch (which also seeds the exercise
 *     library the first time), signed in or not;
 *   - while someone is signed in, runs a sync engine for them, wired to sync
 *     on start, on returning to the foreground, on reconnecting and after each
 *     local change;
 *   - on sign-out or account change, stops that engine. The device data is
 *     kept, so signing back in doesn't re-download history over mobile data.
 *
 * Everything it needs comes through `deps`, so tests run it with an
 * in-memory database and a fake server.
 */
import { useEffect } from 'react';

import type { SqlDriver } from '@/db/driver';

import { SyncEngine, type SyncTriggers } from './engine';
import type { SyncTransport } from './transport';

/** The pieces `useSync` wires together. */
export interface SyncDeps {
  openDatabase: () => Promise<SqlDriver>;
  createTransport: () => SyncTransport;
  triggers: () => SyncTriggers;
}

/** The real pieces: expo-sqlite, Supabase, React Native's AppState and expo-network. */
function defaultDeps(): SyncDeps {
  /* eslint-disable @typescript-eslint/no-require-imports -- loaded lazily so importing this hook in tests never loads native modules */
  const { openAppDatabase } = require('@/db/database') as typeof import('@/db/database');
  const { getSupabase } = require('@/lib/supabase') as typeof import('@/lib/supabase');
  const { createSupabaseTransport } = require('./supabaseTransport') as typeof import('./supabaseTransport');
  const { AppState } = require('react-native') as typeof import('react-native');
  const Network = require('expo-network') as typeof import('expo-network');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    openDatabase: openAppDatabase,
    createTransport: () => createSupabaseTransport(getSupabase()),
    triggers: () => ({ appState: AppState, network: Network }),
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

    d.openDatabase()
      .then((db) => {
        if (cancelled || !userId) return;
        const engine = new SyncEngine({ db, transport: d.createTransport(), userId });
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
