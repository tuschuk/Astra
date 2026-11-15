/**
 * Opening the app's on-device database.
 *
 * `prepareDatabase` is everything that happens to a database file before
 * anything reads it: turn on the safety settings, bring the tables up to the
 * current schema, and make sure the exercise library is there. It takes any
 * `SqlDriver`, so tests run it on an in-memory database.
 *
 * `openAppDatabase` is the app's one shared database, opened on first use.
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

let appDatabase: Promise<SqlDriver> | null = null;

/**
 * The app's one database handle. The first call opens and prepares the file;
 * every later call gets the same handle. If opening fails, the next call
 * tries again rather than remembering the failure forever.
 */
export function openAppDatabase(): Promise<SqlDriver> {
  if (!appDatabase) {
    appDatabase = import('./expoDriver')
      .then(({ openExpoDriver }) => openExpoDriver(DATABASE_NAME))
      .then(prepareDatabase)
      .catch((error: unknown) => {
        appDatabase = null;
        throw error;
      });
  }
  return appDatabase;
}
