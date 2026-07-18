import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, MaritalStatus } from '../types';
import { C, shared } from './shared';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
}

const STATUS_OPTIONS: { value: MaritalStatus; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'civilPartnership', label: 'Civil Partnership' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
];

export default function AboutYou({ data, onChange, onNext }: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!data.fullName.trim()) e.fullName = 'Full name is required';
    if (!data.address.trim()) e.address = 'Address is required';
    if (!data.dob.trim()) e.dob = 'Date of birth is required';
    if (!data.maritalStatus) e.maritalStatus = 'Please select a marital status';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>About You</Text>
      <Text style={shared.sub}>We need a few personal details to create your Will.</Text>

      <Text style={shared.label}>Full legal name *</Text>
      <TextInput
        style={[shared.input, errors.fullName ? shared.inputError : null]}
        placeholder="e.g. John Robert Smith"
        value={data.fullName}
        onChangeText={v => onChange({ fullName: v })}
        autoCapitalize="words"
      />
      {errors.fullName ? <Text style={shared.error}>{errors.fullName}</Text> : null}

      <Text style={shared.label}>Current address *</Text>
      <TextInput
        style={[shared.input, shared.inputMulti, errors.address ? shared.inputError : null]}
        placeholder="Full address including postcode"
        value={data.address}
        onChangeText={v => onChange({ address: v })}
        multiline
        numberOfLines={3}
      />
      {errors.address ? <Text style={shared.error}>{errors.address}</Text> : null}

      <Text style={shared.label}>Date of birth * (DD/MM/YYYY)</Text>
      <TextInput
        style={[shared.input, errors.dob ? shared.inputError : null]}
        placeholder="DD/MM/YYYY"
        value={data.dob}
        onChangeText={v => onChange({ dob: v })}
        keyboardType="numbers-and-punctuation"
      />
      {errors.dob ? <Text style={shared.error}>{errors.dob}</Text> : null}

      <Text style={shared.label}>Marital status *</Text>
      <View style={styles.chipRow}>
        {STATUS_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.chip, data.maritalStatus === opt.value ? styles.chipActive : null]}
            onPress={() => onChange({ maritalStatus: opt.value })}
          >
            <Text style={[styles.chipText, data.maritalStatus === opt.value ? styles.chipTextActive : null]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {errors.maritalStatus ? <Text style={shared.error}>{errors.maritalStatus}</Text> : null}

      <TouchableOpacity style={shared.primaryBtn} onPress={() => validate() && onNext()}>
        <Text style={shared.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  chipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipText: {
    fontSize: 14,
    color: C.text,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
});
