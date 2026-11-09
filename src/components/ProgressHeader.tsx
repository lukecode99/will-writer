import React from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, CONTENT_MAX_WIDTH } from '../screens/shared';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  step: number;       // 0-based current step index
  totalSteps: number;
  title?: string;
  saveState: SaveState;
  onSave: () => void;
  /** Leave this will and go back to the list. Saves on the way out. */
  onHome: () => void;
  /** Shown instead of the app name when filling a will in for someone else. */
  subject?: string;
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'Save',
  saving: 'Saving',
  saved: 'Saved ✓',
  error: 'Not saved',
};

export default function ProgressHeader({
  step,
  totalSteps,
  title,
  saveState,
  onSave,
  onHome,
  subject,
}: Props) {
  const insets = useSafeAreaInsets();
  const current = step + 1;
  const pct = Math.round((current / totalSteps) * 100);

  return (
    // A white iOS nav bar: a back chevron on the left, the subject centred as a
    // title, a plain Save text action on the right, with the progress bar as a
    // thin rule under it. The padding is measured rather than hardcoded because
    // the notch inset differs between a Dynamic Island iPhone, an SE and an iPad.
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.inner}>
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.homeBtn}
            onPress={onHome}
            accessibilityRole="button"
            accessibilityLabel="Save and go back to your wills"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.homeText}>‹</Text>
            <Text style={styles.homeLabel}>Wills</Text>
          </TouchableOpacity>

          <View style={styles.titleBlock}>
            {/* Whose will this is matters more than the app's own name once you
                can be holding several — otherwise every screen looks identical
                whether you are editing your will or your mother's. */}
            <Text style={styles.appTitle} numberOfLines={1}>
              {subject || 'SortedWill'}
            </Text>
            <Text style={styles.stepLabel} numberOfLines={1}>
              {title ? `${title} · step ${current} of ${totalSteps}` : `Step ${current} of ${totalSteps}`}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.saveBtn}
            onPress={onSave}
            disabled={saveState === 'saving'}
            accessibilityRole="button"
            accessibilityLabel="Save your answers"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {saveState === 'saving' ? (
              <ActivityIndicator color={C.primary} size="small" />
            ) : (
              <Text style={[styles.saveText, saveState === 'error' ? styles.saveTextError : null]}>
                {SAVE_LABEL[saveState]}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` as any }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: C.surface,
    paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.hairline,
  },
  // Kept in step with the form column below it, so the title and the progress
  // bar line up with the fields rather than sitting out at the screen edges.
  inner: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  titleBlock: {
    flex: 1,
    alignItems: 'center',
  },
  // iOS back affordance: a tint chevron with a short word label, not a filled
  // circular button.
  homeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 64,
  },
  homeText: {
    color: C.primary,
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '400',
    marginTop: -2,
  },
  homeLabel: {
    color: C.primary,
    fontSize: 16,
    fontWeight: '400',
    marginLeft: 1,
  },
  appTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  stepLabel: {
    color: C.textLight,
    fontSize: 12,
    marginTop: 1,
  },
  saveBtn: {
    minWidth: 64,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  saveText: {
    color: C.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  saveTextError: {
    color: C.danger,
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: C.hairline,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: C.primary,
    // CSS transition for web
    ...(Platform.OS === 'web' ? { transition: 'width 0.3s ease' } as any : {}),
  },
});
