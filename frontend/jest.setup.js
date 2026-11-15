/**
 * Jest setup run before every test file.
 *
 * `expo-sqlite/kv-store` (where the Supabase session is saved on the phone)
 * is backed by a native module with no implementation under Jest. This swaps
 * in a tiny in-memory store with the same methods. Tests never rely on it
 * holding a real session — auth tests inject a fake Supabase client — it just
 * lets modules that import the store load.
 *
 * (Database tests don't use expo-sqlite at all: they run on real SQLite via
 * `src/test-utils/nodeSqliteDriver.ts`.)
 */
jest.mock('expo-sqlite/kv-store', () => {
  const items = new Map();
  const store = {
    getItem: async (key) => (items.has(key) ? items.get(key) : null),
    setItem: async (key, value) => {
      items.set(key, value);
    },
    removeItem: async (key) => {
      items.delete(key);
    },
  };
  return { __esModule: true, default: store, Storage: store, AsyncStorage: store };
});

// `expo-crypto` (new row ids, src/lib/ids.ts) is native too. Node's own
// crypto makes the same kind of random v4 UUID, so it stands in under Jest.
jest.mock('expo-crypto', () => {
  const { randomUUID } = require('crypto');
  return { __esModule: true, randomUUID: () => randomUUID() };
});
