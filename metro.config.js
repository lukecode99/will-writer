const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Fix pnpm symlink resolution: Metro follows real symlink paths, which
// causes ../../App resolution to fail from inside .pnpm/expo.../
// Don't follow symlinks to real paths — use the logical (hoisted) path
// so ../../App resolves from node_modules/expo/AppEntry.js → project root
config.resolver.unstable_enableSymlinks = false;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
