/**
 * Jest setup run before every test file.
 *
 * AsyncStorage is a native module with no implementation under Jest; the
 * package ships an in-memory mock for exactly this. Tests never rely on it
 * holding a real session — auth tests inject a fake Supabase client — it just
 * lets modules that import AsyncStorage load.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
