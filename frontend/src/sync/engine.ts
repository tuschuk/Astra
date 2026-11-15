/**
 * The sync engine: decides WHEN to sync and makes sure only one sync runs at
 * a time. The how lives in push.ts (upload) and pull.ts (download).
 *
 * A sync is "push, then pull": upload the user's changes first so the
 * download that follows already reflects them. The pull runs even if the push
 * failed — one row the server keeps refusing must not stop the device from
 * ever receiving updates. One exception (B14): deletions made on other
 * devices are read and applied BEFORE the push, so this phone never uploads
 * an edit of a workout that no longer exists.
 *
 * When a sync happens (all without the user doing anything — NFR-1):
 *   - when the engine starts (the app opened with someone signed in, or they
 *     just signed in);
 *   - when the app comes back to the foreground;
 *   - when the phone gets a network connection back;
 *   - shortly after the user saves a change.
 * These requests are bunched together (debounced) so a burst of them causes
 * one sync, and a request arriving mid-sync queues exactly one follow-up run.
 *
 * Failures are logged and otherwise forgotten: nothing is marked failed, the
 * outbox still holds whatever didn't upload, and the next trigger retries.
 * There is deliberately no retry timer — the triggers above fire often enough
 * in real use, and adding one waits on evidence that it's needed.
 */
import type { SqlDriver } from '@/db/driver';
import { onLocalWrite } from '@/db/dao';
import type { AppStateLike } from '@/lib/supabase';

import { pullChanges, pullTombstonePass, type PullOptions, type PullResult } from './pull';
import { pushOutbox, type PushResult } from './push';
import type { SyncTransport } from './transport';

/** How long to wait for more requests before starting a sync. */
export const SYNC_DEBOUNCE_MS = 750;

/** The slice of a network-status source the engine needs (expo-network in the app). */
export interface NetworkSourceLike {
  addNetworkStateListener(
    listener: (state: { isConnected?: boolean; isInternetReachable?: boolean }) => void,
  ): { remove: () => void };
}

/** Where the engine's start-up triggers come from. Each is optional. */
export interface SyncTriggers {
  appState?: AppStateLike;
  network?: NetworkSourceLike;
}

/** What one sync run did. `error` fields are set when that half failed. */
export interface SyncRunResult {
  push: PushResult | null;
  pull: PullResult | null;
  pushError?: unknown;
  pullError?: unknown;
}

/** What a sync engine is built from. */
export interface SyncEngineOptions {
  /** The on-device database. */
  db: SqlDriver;
  /** The way to the server (Supabase in the app, a fake in tests). */
  transport: SyncTransport;
  /** The signed-in user; only their workouts are downloaded. */
  userId: string;
  /** How long to wait for more requests before syncing; defaults to SYNC_DEBOUNCE_MS. */
  debounceMs?: number;
  /** Where failures are reported; defaults to a console warning. */
  log?: (message: string, error: unknown) => void;
  /**
   * Told when a download saves the user's settings row (B15) — the app passes the unit store's
   * updater, so a kg/lb change made on another device reaches the screens. Optional.
   */
  onUserSettingsPulled?: PullOptions['onUserSettingsPulled'];
}

/**
 * Keeps one user's device data in sync with the server (see the file
 * comment). Create one per signed-in session; call `start()` to wire up the
 * automatic triggers and the returned function to stop them.
 */
export class SyncEngine {
  private readonly options: Required<Omit<SyncEngineOptions, 'log' | 'onUserSettingsPulled'>> &
    Pick<SyncEngineOptions, 'log' | 'onUserSettingsPulled'>;
  private inFlight: Promise<SyncRunResult> | null = null;
  private runAgain = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: SyncEngineOptions) {
    this.options = { debounceMs: SYNC_DEBOUNCE_MS, ...options };
  }

  /**
   * Runs a sync now. If one is already running, this one is folded into a
   * single follow-up run after it, and the returned promise settles when that
   * follow-up finishes. Never rejects — failures land in the result.
   */
  syncNow(): Promise<SyncRunResult> {
    if (this.inFlight) {
      this.runAgain = true;
      return this.inFlight;
    }
    this.inFlight = (async () => {
      try {
        let result: SyncRunResult;
        do {
          this.runAgain = false;
          result = await this.runOnce();
        } while (this.runAgain && !this.stopped);
        return result;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /** Asks for a sync soon; many requests close together become one sync. */
  requestSync(): void {
    if (this.stopped) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow();
    }, this.options.debounceMs);
  }

  /**
   * Turns on the automatic triggers (foreground, reconnect, local change) and
   * requests a first sync. Returns a function that turns them all off.
   */
  start(triggers: SyncTriggers = {}): () => void {
    this.stopped = false;
    const cleanups: (() => void)[] = [];

    cleanups.push(onLocalWrite(this.options.db, () => this.requestSync()));

    if (triggers.appState) {
      const subscription = triggers.appState.addEventListener('change', (state) => {
        if (state === 'active') this.requestSync();
      });
      cleanups.push(() => subscription.remove());
    }

    if (triggers.network) {
      const subscription = triggers.network.addNetworkStateListener((state) => {
        // "Reachable unknown" counts as online; a failed sync costs nothing.
        if (state.isConnected && state.isInternetReachable !== false) this.requestSync();
      });
      cleanups.push(() => subscription.remove());
    }

    this.requestSync();

    return () => {
      this.stopped = true;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      cleanups.forEach((cleanup) => cleanup());
    };
  }

  /** One push-then-pull, each half's failure caught and logged. */
  private async runOnce(): Promise<SyncRunResult> {
    const { db, transport, userId } = this.options;
    const result: SyncRunResult = { push: null, pull: null };
    try {
      // Deletions from other devices first (B14): otherwise an unsent edit of a workout someone
      // deleted elsewhere would be uploaded — re-creating it, empty, on the server — before the
      // download below could tell this phone it was gone.
      await pullTombstonePass(db, transport, userId);
      result.push = await pushOutbox(db, transport);
    } catch (error) {
      result.pushError = error;
      this.report('Sync: upload failed; changes stay queued for the next attempt', error);
    }
    try {
      result.pull = await pullChanges(db, transport, userId, {
        onUserSettingsPulled: this.options.onUserSettingsPulled,
      });
    } catch (error) {
      result.pullError = error;
      this.report('Sync: download failed; it will resume from the last saved page', error);
    }
    return result;
  }

  /** Sends a failure to the configured log, or the console if none was given. */
  private report(message: string, error: unknown): void {
    if (this.options.log) this.options.log(message, error);
    else console.warn(message, error);
  }
}
