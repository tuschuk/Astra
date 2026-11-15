// ESLint flat config — Expo's recommended ruleset for RN + TypeScript.
//
// Two runs use it (both behind `npm run lint`):
//   - `expo lint` — the app, from frontend/;
//   - `lint:functions` — the Supabase server functions and their shared modules
//     (backend/supabase/functions), run from the repo root with this file passed by `-c`, which
//     makes the repo root the base path the `files` pattern below is matched against.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'coverage/*', 'automation/*'],
  },
  {
    // The import resolver can't see frontend/node_modules from backend/ (`@jest/globals` in the
    // tests) or Deno's `npm:` specifiers (the edge functions' entry files) — Jest and the Deno
    // deploy check those imports instead.
    files: ['backend/supabase/functions/**/*.ts'],
    rules: { 'import/no-unresolved': 'off' },
  },
]);
