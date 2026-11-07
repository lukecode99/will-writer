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
}

/**
 * The standing top bar — navy wordmark on the left, a persistent Account control
 * on the right. Shared by every top-level page (homepage, start/saved-wills,
 * account) so the way in to an account is always in the same place and never has
 * to be hunted for. Kept out of the wizard header deliberately: mid-will is a
 * focused flow, and its header is a progress bar, not navigation.
 */
export default function AppHeader({ onLogoPress, onAccount, accountActive }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
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
          style={[styles.accountBtn, accountActive ? styles.accountBtnActive : null]}
          onPress={onAccount}
          accessibilityRole="button"
          accessibilityLabel="Your account"
          accessibilityState={{ selected: !!accountActive }}
        >
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
    backgroundColor: C.primary,
    paddingHorizontal: 20,
    paddingBottom: 16,
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
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  sub: {
    color: '#C7D6EA',
    fontSize: 13,
    marginTop: 2,
  },
  accountBtn: {
    borderWidth: 1.5,
    borderColor: '#4A6894',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginLeft: 12,
  },
  accountBtnActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  accountBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  accountBtnTextActive: {
    color: C.primary,
  },
});
