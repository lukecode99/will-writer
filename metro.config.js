const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enableSymlinks = false;
config.resolver.unstable_enablePackageExports = true;

// pdf-lib imports tslib named exports (e.g. __extends). Metro resolves tslib's
// CJS main, wraps it as a default export, and named imports come back undefined.
// Point tslib to its ES6 build which has proper named exports.
config.resolver.extraNodeModules = {
  tslib: require.resolve('tslib/tslib.es6.js'),
};

module.exports = config;
