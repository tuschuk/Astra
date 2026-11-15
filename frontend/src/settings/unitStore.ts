/**
 * The unit store — which weight unit (kg or lb) the signed-in lifter has chosen, held in memory
 * so every screen can read it instantly and re-draw the moment it changes (B15, LOG-6).
 *
 * Where the truth lives: the phone's `user_settings` row (schema version 6), which the sync
 * engine keeps in step with the server's `user_settings.unit`. This store is a quick-to-read
 * copy of that row's unit, plus the one way the app changes it:
 *
 *   - `hydrate(db, userId)` — loads the lifter's saved unit when they sign in (no row yet →
 *     pounds, the server's default). Called by `useSync` before the sync engine starts.
 *   - `setUnit(db, userId, unit)` — the Settings toggle. Saves the row AND queues it for upload
 *     in one transaction, so a choice made in airplane mode survives the app being killed and
 *     reaches the server on reconnect. Then every screen showing a weight re-draws. Only the
 *     unit changes: the row's other setting (who sees new progress pics, B26) is kept as is.
 *   - `applyPulled(row)` — a download just saved the server's row (changed on another device).
 *     The store re-reads the phone's row and shows what it says.
 *
 * What it never does: touch a stored weight. Weights are always saved in kg; the unit only
 * decides how `@training-math`'s `displayWeight` shows them and how typed numbers are read
 * (`lbToKg`). Switching units therefore can't change or round any logged set.
 *
 * React reads it through `useDisplayUnit()` (settings/displayUnit.ts), using the
 * subscribe/getSnapshot pair below.
 */
import type { WeightUnit } from '@training-math';

import type { SqlDriver } from '@/db/driver';
import { notifyLocalWrite } from '@/db/dao';
import { patchUserSettingsTx, readUserSettingsRow, type UserSettingsRow } from '@/db/userSettings';
import { enqueueTx } from '@/sync/outbox';

/**
 * The unit every account starts with — the column default of `user_settings.unit` — and what
 * the store shows before the lifter's own setting has been read.
 */
export const DEFAULT_DISPLAY_UNIT: WeightUnit = 'lb';

/** The unit store's surface (see the file comment for what each part is for). */
export interface UnitStore {
  /** Calls `listener` whenever the unit changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** The unit to show right now. Pounds until the lifter's own setting has been loaded. */
  getSnapshot(): WeightUnit;
  /** Loads user `userId`'s saved unit from the phone. Repeat calls for the same user do nothing. */
  hydrate(db: SqlDriver, userId: string): Promise<void>;
  /** Changes the lifter's unit: saved on the phone, queued for the server, shown everywhere. */
  setUnit(db: SqlDriver, userId: string, unit: WeightUnit, options?: { now?: string }): Promise<void>;
  /** A download saved `row`; show the phone's row again (ignored if it's not this user's). */
  applyPulled(row: UserSettingsRow): void;
  /**
   * Forgets the signed-in user and goes back to pounds. `useSync` calls it on sign-out, so the
   * next account never sees the previous one's unit, even for a moment; tests use it between
   * cases.
   */
  reset(): void;
}

/**
 * Builds an independent unit store. The app uses the single `unitStore` below; tests may
 * build their own.
 */
export function createUnitStore(): UnitStore {
  let unit: WeightUnit = DEFAULT_DISPLAY_UNIT;
  let userId: string | null = null;
  let db: SqlDriver | null = null;
  let hydrating: Promise<void> | null = null;
  // Bumped by every change. A slow read that started before a newer change must not overwrite
  // it (for example, the lifter taps the toggle while the sign-in load is still reading).
  let version = 0;
  const listeners = new Set<() => void>();

  /** Sets the shown unit and tells React, only if it actually changed. */
  function show(next: WeightUnit): void {
    if (next === unit) return;
    unit = next;
    listeners.forEach((listener) => listener());
  }

  /** Reads the phone's row for the current user and shows it, unless something newer happened. */
  async function showStoredRow(from: SqlDriver, forUser: string): Promise<void> {
    const startedAt = version;
    const row = await readUserSettingsRow(from, forUser);
    if (version !== startedAt || userId !== forUser) return;
    show(row?.unit ?? DEFAULT_DISPLAY_UNIT);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => unit,

    hydrate(nextDb, nextUser) {
      if (userId === nextUser && db === nextDb && hydrating) return hydrating;
      userId = nextUser;
      db = nextDb;
      version += 1;
      const attempt = showStoredRow(nextDb, nextUser).catch((error: unknown) => {
        // Forget a failed load so the next sign-in (or call) reads again instead of reusing it.
        if (hydrating === attempt) hydrating = null;
        throw error;
      });
      hydrating = attempt;
      return attempt;
    },

    async setUnit(onDb, forUser, next, options = {}) {
      const now = options.now ?? new Date().toISOString();
      await onDb.withTransactionAsync(async (tx) => {
        // A patch, not a whole-row write: the row also holds the progress-pic privacy choice
        // (B26), which a unit toggle must leave exactly as it was.
        await patchUserSettingsTx(tx, forUser, { unit: next }, now);
        // The outbox line's row id is the user id: that is the settings table's key.
        await enqueueTx(tx, 'user_settings', forUser, now);
      });
      if (userId === null) {
        userId = forUser;
        db = onDb;
      }
      if (userId === forUser) {
        version += 1;
        show(next);
      }
      notifyLocalWrite(onDb, ['user_settings']);
    },

    applyPulled(row) {
      // An account switch mid-sync must never stamp the new user's screens with the old
      // user's unit.
      if (row.user_id !== userId || !db) return;
      // Re-read rather than trust `row`: the phone's row is the truth, and a toggle saved just
      // after the download committed must win on screen as it does on disk.
      void showStoredRow(db, row.user_id).catch((error: unknown) => {
        console.warn('Settings: could not re-read the unit after a download', error);
      });
    },

    reset() {
      userId = null;
      db = null;
      hydrating = null;
      version += 1;
      show(DEFAULT_DISPLAY_UNIT);
    },
  };
}

/** The app's one unit store. */
export const unitStore: UnitStore = createUnitStore();
