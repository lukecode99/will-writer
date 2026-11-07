/**
 * withExcludeWillStoreFromBackup
 * ------------------------------
 * SortedWill's whole promise is "we keep no copy of your will". The wills live
 * only in on-device storage (AsyncStorage, under the app's Application Support
 * directory). Without this, iOS would fold that directory into the user's iCloud
 * / encrypted-iTunes device backup — so a copy of every will would sit on Apple's
 * servers inside the backup, quietly breaking the promise.
 *
 * iOS has no static Info.plist switch for this: NSURLIsExcludedFromBackupKey is a
 * per-URL resource value that must be set at runtime. So this config plugin
 * injects a few lines into the AppDelegate's didFinishLaunching to mark the
 * Application Support directory (where AsyncStorage keeps the wills) as excluded
 * from backup. Excluding a directory excludes its whole subtree, including the
 * RCTAsyncLocalStorage folder AsyncStorage creates inside it, and the flag
 * persists across launches — so it is safe to re-set on every launch.
 *
 * Expo SDK 52 ships an Objective-C AppDelegate (AppDelegate.mm); the merge below
 * targets its didFinishLaunchingWithOptions. If a future SDK moves AppDelegate to
 * Swift, this merge will no-op and the plugin will need the Swift variant.
 */
const { withAppDelegate } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const SNIPPET = `
  // SortedWill: keep the on-device will store out of iCloud/iTunes backups so the
  // "we keep no copy of your will" promise holds even through a device backup.
  // Excluding Application Support excludes the AsyncStorage folder inside it.
  {
    NSURL *appSupport = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] lastObject];
    if (appSupport) {
      [[NSFileManager defaultManager] createDirectoryAtURL:appSupport withIntermediateDirectories:YES attributes:nil error:nil];
      NSError *swExcludeErr = nil;
      [appSupport setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:&swExcludeErr];
      if (swExcludeErr) { NSLog(@"SortedWill backup-exclude failed: %@", swExcludeErr); }
    }
  }
`;

module.exports = function withExcludeWillStoreFromBackup(config) {
  return withAppDelegate(config, (cfg) => {
    if (!cfg.modResults.contents.includes('SortedWill backup-exclude')) {
      const merged = mergeContents({
        tag: 'sortedwill-exclude-backup',
        src: cfg.modResults.contents,
        newSrc: SNIPPET,
        // mergeContents matches the anchor against each line individually, so the
        // anchor must fit on ONE line. In the SDK 52 AppDelegate.mm the method
        // signature and its opening `{` are on separate lines, so we anchor on
        // the signature line (the only one carrying the `(NSDictionary` argument
        // — the `return [super …]` line reads `:launchOptions`, so it won't
        // match) and use offset 2 to land just past the `{`, inside the body.
        anchor: /didFinishLaunchingWithOptions:\(NSDictionary/,
        offset: 2,
        comment: '//',
      });
      cfg.modResults.contents = merged.contents;
    }
    return cfg;
  });
};
