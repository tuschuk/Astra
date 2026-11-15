/**
 * The seam between Astra's on-device database code and the SQLite engine that
 * actually runs it.
 *
 * Why this exists: on the phone, SQLite is `expo-sqlite` (a native module); in
 * Jest it is Node's built-in `node:sqlite`. Everything above this file — the
 * schema, the data-access functions, the sync engine — talks only to the
 * `SqlDriver` interface, so the same code is tested against a real SQLite
 * database in Jest and runs unchanged on the device.
 *
 * It also makes the database safe to use from several places at once. The
 * sync engine, the library seed and (from B08) the workout logger all share
 * one connection; without care, a read from one could land in the middle of
 * another's half-finished transaction. `createSerializedDriver` puts every
 * statement and every transaction in a single queue, so a transaction always
 * runs alone from BEGIN to COMMIT.
 */

/** A value SQLite can store: text, a number, or nothing. */
export type SqlValue = string | number | null;

/**
 * The `?, ?, ?` list for an `in (…)` clause with `count` values — one
 * placeholder per value, so values are always passed separately from the SQL
 * text and can never be misread as SQL.
 */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** What a write statement reports back. */
export interface RunResult {
  /** How many rows the statement inserted, changed or deleted. */
  changes: number;
}

/**
 * The four things code can do with the database: run a script, run one
 * write statement, read every matching row, or read the first matching row.
 * Parameters are `?` placeholders filled from `params` in order.
 */
export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  getAllAsync<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
}

/**
 * The database handle the app uses: the four operations above, plus
 * all-or-nothing transactions.
 *
 * `withTransactionAsync(task)` runs `task` inside BEGIN … COMMIT. If `task`
 * throws, everything it wrote is rolled back and the error is re-thrown, so a
 * change and its bookkeeping (e.g. a set and its outbox entry) always land
 * together or not at all.
 *
 * IMPORTANT: inside `task`, use only the `tx` handle it is given. Calling the
 * outer driver from inside a transaction waits behind the transaction itself
 * and never finishes.
 */
export interface SqlDriver extends SqlExecutor {
  withTransactionAsync<T>(task: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/**
 * Turns a raw, unsynchronised SQLite connection into a `SqlDriver` whose
 * operations run strictly one at a time, in the order they were requested.
 *
 * Input: `raw` — the engine's own execute functions (expo-sqlite or node:sqlite).
 * Output: a driver where each statement waits its turn, and a transaction
 * holds the turn from its BEGIN until its COMMIT or ROLLBACK.
 */
export function createSerializedDriver(raw: SqlExecutor): SqlDriver {
  // The tail of the queue: every new operation chains onto it.
  let tail: Promise<unknown> = Promise.resolve();

  /** Queues `work` behind everything already queued; resolves with its result. */
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work, work);
    // The queue keeps moving whether this operation succeeds or fails.
    tail = result.catch(() => undefined);
    return result;
  }

  return {
    execAsync: (sql) => enqueue(() => raw.execAsync(sql)),
    runAsync: (sql, params) => enqueue(() => raw.runAsync(sql, params)),
    getAllAsync: <T>(sql: string, params?: readonly SqlValue[]) =>
      enqueue(() => raw.getAllAsync<T>(sql, params)),
    getFirstAsync: <T>(sql: string, params?: readonly SqlValue[]) =>
      enqueue(() => raw.getFirstAsync<T>(sql, params)),
    withTransactionAsync: <T>(task: (tx: SqlExecutor) => Promise<T>) =>
      enqueue(async () => {
        await raw.execAsync('BEGIN');
        try {
          const value = await task(raw);
          await raw.execAsync('COMMIT');
          return value;
        } catch (error) {
          // If the rollback itself fails, the original error is still the
          // one worth reporting — never let the rollback's error replace it.
          await raw.execAsync('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }),
  };
}
