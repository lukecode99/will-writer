import React from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONTENT_MAX_WIDTH } from '../screens/shared';

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
    // The navy runs full width and up under the status bar; the padding is
    // measured rather than hardcoded, because the notch inset differs between
    // an iPhone with Dynamic Island, an SE, and an iPad (which has none).
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
      <View style={styles.inner}>
        <View style={styles.row}>
          {/* Title and step stack vertically rather than sitting side by side,
              which leaves room for the save control on the right without it
              crowding the step name on a narrow phone. */}
          <TouchableOpacity
            style={styles.homeBtn}
            onPress={onHome}
            accessibilityRole="button"
            accessibilityLabel="Save and go back to your wills"
          >
            <Text style={styles.homeText}>‹</Text>
          </TouchableOpacity>

          <View style={styles.titleBlock}>
            {/* Whose will this is matters more than the app's own name once you
                can be holding several — otherwise every screen looks identical
                whether you are editing your will or your mother's. */}
            <Text style={styles.appTitle} numberOfLines={1}>
              {subject || 'Will Writer'}
            </Text>
            <Text style={styles.stepLabel} numberOfLines={1}>
              {title ? `${title} · step ${current} of ${totalSteps}` : `Step ${current} of ${totalSteps}`}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, saveState === 'error' ? styles.saveBtnError : null]}
            onPress={onSave}
            disabled={saveState === 'saving'}
            accessibilityRole="button"
            accessibilityLabel="Save your answers"
          >
            {saveState === 'saving' ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.saveText}>{SAVE_LABEL[saveState]}</Text>
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
    backgroundColor: '#1B3A6B',
    paddingBottom: 12,
    paddingHorizontal: 20,
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
    gap: 12,
  },
  titleBlock: {
    flex: 1,
  },
  homeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginLeft: -4,
  },
  homeText: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '700',
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  stepLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  saveBtn: {
    minWidth: 74,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnError: {
    borderColor: '#FCA5A5',
    backgroundColor: 'rgba(220,38,38,0.35)',
  },
  saveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    // CSS transition for web
    ...(Platform.OS === 'web' ? { transition: 'width 0.3s ease' } as any : {}),
  },
});
