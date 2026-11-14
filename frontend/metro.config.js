/**
 * Metro (the app bundler) configuration: Expo's defaults plus one addition.
 *
 * The shared training-math module lives outside this folder, in
 * backend/supabase/functions/_shared/training-math, so Supabase's server functions can bundle
 * it too (docs/feature_plans/training-math.md). Metro only sees files inside `watchFolders`, and
 * the `@training-math` import name is mapped here explicitly rather than trusting tsconfig-path
 * resolution to reach outside the project root. Same alias as tsconfig.json and jest.config.js.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const TRAINING_MATH = path.resolve(__dirname, '../backend/supabase/functions/_shared/training-math');

const config = getDefaultConfig(__dirname);

config.watchFolders = [...(config.watchFolders ?? []), TRAINING_MATH];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@training-math') {
    return { type: 'sourceFile', filePath: path.join(TRAINING_MATH, 'index.ts') };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
