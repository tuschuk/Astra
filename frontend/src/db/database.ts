/**
 * Opening the app's on-device database.
 *
 * `prepareDatabase` is everything that happens to a database file before
 * anything reads it: turn on the safety settings, bring the tables up to the
 * current schema, and make sure the exercise library is there. It takes any
 * `SqlDriver`, so tests run it on an in-memory database.
 *
 * `openAppDatabase` is the app's one shared database, opened on first use.
 * `deleteAppDatabase` (B32) closes it and deletes the file — the device wipe
 * after an account is deleted.
 */
import { seedLocalLibrary } from '@/library/seedLocal';

import type { SqlDriver } from './driver';
import { migrate } from './schema';

/** The database file's name in the app's private storage. */
export const DATABASE_NAME = 'astra.db';

/**
 * Readies a freshly opened database:
 *   - foreign keys on, so a set can't point at an entry that doesn't exist
 *     (SQLite leaves them off unless asked, per connection);
 *   - write-ahead logging, so a committed change survives the app being
 *     killed and reads don't block writes (on in-memory test databases this
 *     setting is ignored, harmlessly);
 *   - schema migrations;
 *   - the library seed (only adds what is missing).
 */
export async function prepareDatabase(db: SqlDriver): Promise<SqlDriver> {
  await db.execAsync('pragma foreign_keys = on');
  await db.execAsync('pragma journal_mode = wal');
  await migrate(db);
  await seedLocalLibrary(db);
  return db;
}

/** Opening and closing one shared database handle (see `createDatabaseHolder`). */
export interface DatabaseHolder {
  open(): Promise<SqlDriver>;
  close(afterClose?: () => Promise<void>): Promise<void>;
}

/**
 * Keeps one shared handle made by `opener`:
 *   - `open()`: the first call opens; every later call gets the same handle. If opening fails,
 *     the next call tries again rather than remembering the failure forever.
 *   - `close(afterClose?)` (B32): closes the handle and forgets it, so the next `open()` opens
 *     afresh. Anything already queued on the handle finishes first. `afterClose` runs once the
 *     handle is closed — the device wipe passes "delete the file" — and any `open()` asked for
 *     meanwhile WAITS until it is done, so nothing can reopen the file between the close and the
 *     delete (after sign-out the sync hook does ask for the database). A handle that never
 *     opened, or fails to close, just counts as closed; only `afterClose`'s own error is thrown.
 * A factory (not module state) so tests can run it with a fake opener.
 */
export function createDatabaseHolder(opener: () => Promise<SqlDriver>): DatabaseHolder {
  let current: Promise<SqlDriver> | null = null;
  // While a close (and its afterClose) is running: new opens queue behind it.
  let closing: Promise<void> | null = null;
  return {
    open() {
      if (!current) {
        const start = closing ? closing.then(opener) : opener();
        const opening = start.catch((error: unknown) => {
          // Forget the failure — unless a close (and maybe a new open) has already moved on.
          if (current === opening) current = null;
          throw error;
        });
        current = opening;
      }
      return current;
    },
    async close(afterClose) {
      const pending = current;
      current = null;
      const run = (async () => {
        const db = pending ? await pending.catch(() => null) : null;
        await db?.closeAsync?.().catch((error: unknown) => console.warn('The on-device database did not close cleanly', error));
        if (afterClose) await afterClose();
      })();
      const gate = run.catch(() => undefined);
      closing = gate;
      try {
        await run;
      } finally {
        if (closing === gate) closing = null;
      }
    },
  };
}

/** The app's real database: `astra.db`, opened with expo-sqlite and prepared. */
const appDatabase = createDatabaseHolder(() =>
  import('./expoDriver').then(({ openExpoDriver }) => openExpoDriver(DATABASE_NAME)).then(prepareDatabase),
);

/** The app's one database handle (see `createDatabaseHolder`'s `open`). */
export function openAppDatabase(): Promise<SqlDriver> {
  return appDatabase.open();
}

/**
 * Closes the app's database and deletes its file from the phone (B32's device wipe after an
 * account is deleted), with nothing able to reopen it in between (see `createDatabaseHolder`).
 * The next `openAppDatabase` makes a fresh, empty database. Throws if the file can't be
 * deleted; the wipe logs that and carries on.
 */
export function deleteAppDatabase(): Promise<void> {
  return appDatabase.close(async () => {
    const { deleteExpoDatabase } = await import('./expoDriver');
    await deleteExpoDatabase(DATABASE_NAME);
  });
}
