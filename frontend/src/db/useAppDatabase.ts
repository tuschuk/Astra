/**
 * `useAppDatabase` — gives a screen the app's one on-device database once it is open.
 *
 * Opening is asynchronous (the file is opened, migrated and seeded on first use — see
 * `openAppDatabase`), so the hook returns null until the handle is ready, then the handle.
 * Every caller shares the same handle; calling this on many screens opens nothing twice.
 * If opening fails, `error` says so and the screen can tell the lifter instead of hanging.
 */
import { useEffect, useState } from 'react';

import { openAppDatabase } from './database';
import type { SqlDriver } from './driver';

/** The database handle (null while opening) and whether opening failed. */
export interface AppDatabaseState {
  db: SqlDriver | null;
  error: boolean;
}

/** See the file comment. */
export function useAppDatabase(): AppDatabaseState {
  const [state, setState] = useState<AppDatabaseState>({ db: null, error: false });
  useEffect(() => {
    let cancelled = false;
    openAppDatabase()
      .then((db) => {
        if (!cancelled) setState({ db, error: false });
      })
      .catch((error: unknown) => {
        console.warn('The on-device database could not be opened', error);
        if (!cancelled) setState({ db: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
