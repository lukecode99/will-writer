import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, CONTENT_MAX_WIDTH } from '../screens/shared';

interface Props {
  /** Tap the wordmark to return to the front door. */
  onLogoPress: () => void;
  /** Open the account screen. */
  onAccount: () => void;
  /** When the account screen is itself on view, the control reads as the current
   *  page rather than a link away from it. */
  accountActive?: boolean;
  /** When signed in, the first letter of the account email — shown as a small
   *  circle on the Account control so the signed-in state is visible at a glance
   *  from any page, not only on the account screen itself. */
  accountInitial?: string;
}

/**
 * The standing top bar, styled as an iOS navigation bar: a white chrome strip
 * with a hairline bottom separator, the navy wordmark on the left, and a plain
 * tappable Account action on the right (no bordered pill). Shared by every
 * top-level page so the way in to an account is always in the same place.
 * Kept out of the wizard header deliberately — mid-will its header is a
 * progress bar, not navigation.
 */
export default function AppHeader({ onLogoPress, onAccount, accountActive, accountInitial }: Props) {
  const insets = useSafeAreaInsets();
  const initial = accountInitial ? accountInitial.trim().charAt(0).toUpperCase() : '';
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.inner}>
        <TouchableOpacity
          style={styles.titleBlock}
          onPress={onLogoPress}
          accessibilityRole="link"
          accessibilityLabel="SortedWill — go to the home page"
        >
          <Text style={styles.title}>SortedWill</Text>
          <Text style={styles.sub}>Wills for England and Wales</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.accountBtn}
          onPress={onAccount}
          accessibilityRole="button"
          accessibilityLabel={initial ? 'Your account, signed in' : 'Your account'}
          accessibilityState={{ selected: !!accountActive }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {initial ? (
            <View style={styles.initialDot}>
              <Text style={styles.initialText}>{initial}</Text>
            </View>
          ) : null}
          <Text style={[styles.accountBtnText, accountActive ? styles.accountBtnTextActive : null]}>
            Account
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    // White nav-bar chrome with a hairline under it, the way an iOS
    // UINavigationController sits above the scrolling content.
    backgroundColor: C.surface,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.hairline,
  },
  inner: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleBlock: {
    flexShrink: 1,
  },
  title: {
    color: C.primary,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sub: {
    color: C.textLight,
    fontSize: 12,
    marginTop: 1,
  },
  // A plain text action — the iOS bar-button convention — rather than a
  // bordered button that reads as a web pill.
  accountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  initialDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  initialText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  accountBtnText: {
    color: C.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  accountBtnTextActive: {
    // On the account page itself the control is the current page, so it reads
    // as inert grey rather than a live tint link.
    color: C.textLight,
  },
});
