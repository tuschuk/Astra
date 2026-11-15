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
    // B32: the device wipe after account deletion empties the whole store.
    clear: async () => {
      items.clear();
    },
  };
  return { __esModule: true, default: store, Storage: store, AsyncStorage: store };
});

// B28: the share card's two native modules. `react-native-view-shot` captures a view to an
// image file and `expo-sharing` opens the phone's share sheet — neither exists under Jest, and
// the capture itself is only provable on a device. These stand-ins answer the way the real
// ones do on a phone that can share; tests override them per case (`jest.mocked(...)`).
jest.mock('react-native-view-shot', () => ({
  __esModule: true,
  captureRef: jest.fn(async () => 'file:///tmp/share-card.png'),
}));
jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

// `expo-crypto` (new row ids, src/lib/ids.ts) is native too. Node's own
// crypto makes the same kind of random v4 UUID, so it stands in under Jest.
jest.mock('expo-crypto', () => {
  const { randomUUID } = require('crypto');
  return { __esModule: true, randomUUID: () => randomUUID() };
});
