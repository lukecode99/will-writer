const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enableSymlinks = false;
config.resolver.unstable_enablePackageExports = true;

// pdf-lib does `import { __extends } from 'tslib'`. tslib's exports map sends
// anything that isn't an explicit "import"/"module" condition to ./tslib.js,
// which is CJS — Metro wraps it as a default export and every named import
// comes back undefined, so pdf-lib throws at module scope and takes the whole
// app down with it.
//
// extraNodeModules is not enough here: it is only consulted when a module
// cannot otherwise be resolved, and tslib resolves fine (to the wrong file).
// The request has to be intercepted.
const TSLIB_ES6 = path.resolve(__dirname, 'node_modules/tslib/tslib.es6.js');

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib') {
    return { type: 'sourceFile', filePath: TSLIB_ES6 };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
