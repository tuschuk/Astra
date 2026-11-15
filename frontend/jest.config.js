/**
 * Jest configuration. The jest-expo preset wires up React Native + Expo
 * mocks and already whitelists the RN/Expo packages that ship untranspiled
 * ESM, so transformIgnorePatterns is deliberately not overridden here.
 */
const path = require('path');

// The shared modules live with the server functions (see docs/feature_plans/training-math.md
// and analysis-engine.md); the app's Jest runs their tests too, plus the server functions'
// own tests in functions/tests/ (CLAUDE.md's home for them).
const FUNCTIONS = path.resolve(__dirname, '../backend/supabase/functions');
const TRAINING_MATH = path.join(FUNCTIONS, '_shared/training-math');
const ANALYSIS = path.join(FUNCTIONS, '_shared/analysis');
const FUNCTION_TESTS = path.join(FUNCTIONS, 'tests');

module.exports = {
  preset: 'jest-expo',
  // First test in a suite pays the Babel transform warm-up on this project's
  // dependency graph; 5s default flakes on cold caches.
  testTimeout: 30000,
  roots: ['<rootDir>', TRAINING_MATH, ANALYSIS, FUNCTION_TESTS],
  // Route files live in src/app; tests live beside src code, never in src/app
  // (expo-router would register them as routes). The last three patterns reach the
  // shared modules' tests and the server-function tests, whose paths have no `src` segment.
  testMatch: [
    '**/src/**/*.test.ts',
    '**/src/**/*.test.tsx',
    '**/_shared/training-math/**/*.test.ts',
    '**/_shared/analysis/**/*.test.ts',
    '**/functions/tests/**/*.test.ts',
  ],
  // `@training-math` and `@analysis` are the one import name of each shared module (same
  // aliases as tsconfig.json and metro.config.js).
  moduleNameMapper: {
    '^@training-math$': path.join(TRAINING_MATH, 'index.ts'),
    '^@analysis$': path.join(ANALYSIS, 'index.ts'),
  },
  // Babel injects `@babel/runtime/helpers/*` imports into transformed files. For the
  // files under backend/, Jest's resolver walks up from there and never reaches
  // frontend/node_modules, so the suites fail with "Cannot find module
  // '@babel/runtime/helpers/interopRequireDefault'" on a cold transform cache. Naming
  // this project's node_modules as a module directory fixes resolution for files
  // outside the project root without affecting anything inside it.
  moduleDirectories: ['node_modules', path.join(__dirname, 'node_modules')],
  // Native-module mocks (expo-sqlite's key-value store) — see jest.setup.js.
  setupFiles: ['<rootDir>/jest.setup.js'],
};
