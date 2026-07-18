import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, BurialPreference } from '../types';
import { C, shared } from './shared';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const BURIAL_OPTIONS: { value: BurialPreference; label: string }[] = [
  { value: 'burial', label: '⚱️  Burial' },
  { value: 'cremation', label: '🌸  Cremation' },
  { value: 'noPreference', label: 'No preference' },
];

export default function FuneralWishes({ data, onChange, onNext, onBack }: Props) {
  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Funeral Wishes</Text>
      <Text style={shared.sub}>
        Express your wishes — these are advisory only (not legally binding) but help your executors and family.
        This entire step is optional.
      </Text>

      <Text style={shared.label}>Burial or cremation preference</Text>
      <View style={styles.optRow}>
        {BURIAL_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.opt, data.burialPreference === opt.value ? styles.optActive : null]}
            onPress={() => {
              onChange({ burialPreference: opt.value });
            }}
          >
            <Text style={[styles.optText, data.burialPreference === opt.value ? styles.optTextActive : null]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={shared.label}>Any other wishes</Text>
      <Text style={shared.hint}>Music, readings, flowers, charitable donations in lieu, etc.</Text>
      <TextInput
        style={[shared.input, shared.inputMulti, { minHeight: 100 }]}
        placeholder="e.g. I would like a small, private ceremony with close family only..."
        value={data.funeralWishes}
        onChangeText={v => onChange({ funeralWishes: v })}
        multiline
        numberOfLines={4}
        autoCapitalize="sentences"
      />

      <TouchableOpacity style={shared.primaryBtn} onPress={onNext}>
        <Text style={shared.primaryBtnText}>
          {data.burialPreference || data.funeralWishes ? 'Continue' : 'Skip (no wishes to record)'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  optRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  opt: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  optActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  optText: {
    fontSize: 14,
    color: C.text,
  },
  optTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
});
