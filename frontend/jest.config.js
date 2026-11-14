/**
 * Jest configuration. The jest-expo preset wires up React Native + Expo
 * mocks and already whitelists the RN/Expo packages that ship untranspiled
 * ESM, so transformIgnorePatterns is deliberately not overridden here.
 */
module.exports = {
  preset: 'jest-expo',
  // First test in a suite pays the Babel transform warm-up on this project's
  // dependency graph; 5s default flakes on cold caches.
  testTimeout: 30000,
  // Route files live in src/app; tests live beside src code, never in src/app
  // (expo-router would register them as routes).
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx'],
  // Native-module mocks (AsyncStorage) — see jest.setup.js.
  setupFiles: ['<rootDir>/jest.setup.js'],
};
