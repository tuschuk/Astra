/**
 * A real SQLite database for Jest tests, using Node's built-in `node:sqlite`.
 *
 * Why this exists: the device store's correctness (foreign keys, upserts,
 * transactions rolling back) is SQLite behaviour, and a hand-written fake
 * would only prove that the fake agrees with itself. Node 22 ships SQLite, so
 * every database test runs against the real engine, in memory, with no extra
 * dependency. Behind the same `SqlDriver` interface the app uses on-device.
 *
 * Node prints an "ExperimentalWarning: SQLite is an experimental feature" line
 * when this loads; it is test-only noise.
 */
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import { createSerializedDriver, type SqlDriver, type SqlValue } from '@/db/driver';

/** Node's rows come back without a normal prototype; copy them into plain objects. */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

/**
 * Opens a fresh in-memory SQLite database (or a file, if `path` is given) as a
 * `SqlDriver`. Each call is an independent, empty database.
 */
export function createNodeSqliteDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path);
  return createSerializedDriver({
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, params: readonly SqlValue[] = []) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    getAllAsync: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      db
        .prepare(sql)
        .all(...params)
        .map((row) => plain<T>(row)),
    getFirstAsync: async <T>(sql: string, params: readonly SqlValue[] = []) => {
      const row = db.prepare(sql).get(...params);
      return row === undefined ? null : plain<T>(row);
    },
  });
}
