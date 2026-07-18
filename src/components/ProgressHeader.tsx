import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

interface Props {
  step: number;       // 0-based current step index
  totalSteps: number;
  title?: string;
}

export default function ProgressHeader({ step, totalSteps, title }: Props) {
  const current = step + 1;
  const pct = Math.round((current / totalSteps) * 100);

  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <Text style={styles.appTitle}>Will Writer</Text>
        {title ? (
          <Text style={styles.stepLabel}>{title}</Text>
        ) : (
          <Text style={styles.stepLabel}>Step {current} of {totalSteps}</Text>
        )}
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` as any }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#1B3A6B',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  stepLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
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
