/**
 * The phone's real database: `expo-sqlite`, wrapped as a `SqlDriver`.
 *
 * Why this exists: it is the only file that imports expo-sqlite's database API,
 * so every other database file stays engine-agnostic and testable in Jest (see
 * `driver.ts`). It opens the named database file in the app's private storage
 * and routes every call through the serialising queue.
 */
import { openDatabaseAsync } from 'expo-sqlite';

import { createSerializedDriver, type SqlDriver, type SqlValue } from './driver';

/**
 * Opens (creating if needed) the on-device SQLite file `name` and returns it
 * as a `SqlDriver`. Schema setup is not done here — see `database.ts`.
 */
export async function openExpoDriver(name: string): Promise<SqlDriver> {
  const db = await openDatabaseAsync(name);
  return createSerializedDriver({
    execAsync: (sql) => db.execAsync(sql),
    runAsync: async (sql, params = []) => {
      const result = await db.runAsync(sql, [...params]);
      return { changes: result.changes };
    },
    getAllAsync: <T>(sql: string, params: readonly SqlValue[] = []) => db.getAllAsync<T>(sql, [...params]),
    getFirstAsync: <T>(sql: string, params: readonly SqlValue[] = []) => db.getFirstAsync<T>(sql, [...params]),
  });
}
