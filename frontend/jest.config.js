/**
 * Jest configuration. The jest-expo preset wires up React Native + Expo
 * mocks and already whitelists the RN/Expo packages that ship untranspiled
 * ESM, so transformIgnorePatterns is deliberately not overridden here.
 */
const path = require('path');

// The shared training-math module lives with the server functions (see
// docs/feature_plans/training-math.md); the app's Jest runs its tests too.
const TRAINING_MATH = path.resolve(__dirname, '../backend/supabase/functions/_shared/training-math');

module.exports = {
  preset: 'jest-expo',
  // First test in a suite pays the Babel transform warm-up on this project's
  // dependency graph; 5s default flakes on cold caches.
  testTimeout: 30000,
  roots: ['<rootDir>', TRAINING_MATH],
  // Route files live in src/app; tests live beside src code, never in src/app
  // (expo-router would register them as routes). The last pattern reaches the
  // training-math tests, whose path has no `src` segment.
  testMatch: [
    '**/src/**/*.test.ts',
    '**/src/**/*.test.tsx',
    '**/_shared/training-math/**/*.test.ts',
  ],
  // `@training-math` is the one import name for the shared module (same alias
  // as tsconfig.json and metro.config.js).
  moduleNameMapper: {
    '^@training-math$': path.join(TRAINING_MATH, 'index.ts'),
  },
  // Native-module mocks (AsyncStorage) — see jest.setup.js.
  setupFiles: ['<rootDir>/jest.setup.js'],
};
