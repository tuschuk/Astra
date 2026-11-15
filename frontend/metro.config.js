/**
 * Metro (the app bundler) configuration: Expo's defaults plus the shared server modules.
 *
 * Two modules live outside this folder, in backend/supabase/functions/_shared, so Supabase's
 * server functions can bundle them too: training-math (docs/feature_plans/training-math.md) and
 * the post-workout analysis rules (B18, docs/feature_plans/analysis-engine.md). Metro only sees
 * files inside `watchFolders`, and the `@training-math` / `@analysis` import names are mapped
 * here explicitly rather than trusting tsconfig-path resolution to reach outside the project
 * root. Same aliases as tsconfig.json and jest.config.js.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const SHARED = path.resolve(__dirname, '../backend/supabase/functions/_shared');
const ALIASES = {
  '@training-math': path.join(SHARED, 'training-math'),
  '@analysis': path.join(SHARED, 'analysis'),
};

const config = getDefaultConfig(__dirname);

config.watchFolders = [...(config.watchFolders ?? []), ...Object.values(ALIASES)];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const folder = ALIASES[moduleName];
  if (folder) {
    return { type: 'sourceFile', filePath: path.join(folder, 'index.ts') };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
