import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet } from 'react-native';
import { WillData, SpecificGift, GiftSubstitutionType } from '../types';
import { C, shared } from './shared';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

const GIFT_SUB_OPTIONS: Array<{ value: GiftSubstitutionType; label: string }> = [
  { value: 'residue', label: 'Falls into the residuary estate (default)' },
  { value: 'named', label: 'Passes to someone else' },
];

export default function SpecificGifts({ data, onChange, onNext, onBack }: Props) {
  function addGift() {
    onChange({
      specificGifts: [
        ...data.specificGifts,
        { id: uid(), recipient: '', description: '', isCharity: false, substitutionType: 'residue', substitutionRecipient: '' },
      ],
    });
  }

  function updateGift(id: string, updates: Partial<SpecificGift>) {
    onChange({
      specificGifts: data.specificGifts.map(g => g.id === id ? { ...g, ...updates } : g),
    });
  }

  function removeGift(id: string) {
    onChange({ specificGifts: data.specificGifts.filter(g => g.id !== id) });
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Specific Gifts</Text>
      <Text style={shared.sub}>
        Leave specific items of cash, property, or belongings to named individuals or charities.
        This step is optional — skip if everything goes to your residuary beneficiaries.
      </Text>
      <Text style={shared.hint}>
        Examples: "£5,000 in cash", "my vintage watch", "my share of 10 Acacia Avenue", "£1,000 to Cancer Research UK"
      </Text>

      {data.specificGifts.map((gift, i) => (
        <View key={gift.id} style={shared.card}>
          <View style={shared.cardHeader}>
            <Text style={shared.cardTitle}>Gift {i + 1}</Text>
            <TouchableOpacity style={shared.dangerBtn} onPress={() => removeGift(gift.id)}>
              <Text style={shared.dangerBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>

          <Text style={shared.label}>What are you giving?</Text>
          <TextInput
            style={shared.input}
            placeholder="e.g. £5,000 in cash / my vintage watch"
            value={gift.description}
            onChangeText={v => updateGift(gift.id, { description: v })}
          />

          <Text style={shared.label}>Recipient</Text>
          <TextInput
            style={shared.input}
            placeholder="Full name, or charity name"
            value={gift.recipient}
            onChangeText={v => updateGift(gift.id, { recipient: v })}
            autoCapitalize="words"
          />

          <View style={styles.switchRow}>
            <Switch
              value={gift.isCharity}
              onValueChange={v => updateGift(gift.id, { isCharity: v })}
              thumbColor={gift.isCharity ? C.primary : '#ccc'}
              trackColor={{ false: '#ddd', true: '#9BAFD1' }}
            />
            <Text style={styles.switchLabel}>This is a charity</Text>
          </View>

          <Text style={[shared.label, { marginTop: 16 }]}>
            If {gift.recipient || 'the recipient'} doesn't survive you
          </Text>
          <View style={styles.radioGroup}>
            {GIFT_SUB_OPTIONS.map(opt => {
              const selected = gift.substitutionType === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.radioOption, selected && styles.radioOptionSelected]}
                  onPress={() => updateGift(gift.id, { substitutionType: opt.value })}
                >
                  <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
                    {selected && <View style={styles.radioInner} />}
                  </View>
                  <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {gift.substitutionType === 'named' && (
            <>
              <Text style={shared.label}>Alternative recipient</Text>
              <TextInput
                style={shared.input}
                placeholder="Full name or charity name"
                value={gift.substitutionRecipient}
                onChangeText={v => updateGift(gift.id, { substitutionRecipient: v })}
                autoCapitalize="words"
              />
            </>
          )}
        </View>
      ))}

      <TouchableOpacity style={shared.addBtn} onPress={addGift}>
        <Text style={shared.addBtnText}>+ Add a specific gift</Text>
      </TouchableOpacity>

      <TouchableOpacity style={shared.primaryBtn} onPress={onNext}>
        <Text style={shared.primaryBtnText}>
          {data.specificGifts.length === 0 ? 'Skip (no specific gifts)' : 'Continue'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  switchLabel: {
    marginLeft: 8,
    fontSize: 14,
    color: C.text,
  },
  radioGroup: {
    marginTop: 6,
    gap: 8,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
    gap: 10,
  },
  radioOptionSelected: {
    borderColor: C.primary,
    backgroundColor: '#EEF2FA',
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: C.primary,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  radioLabel: {
    fontSize: 14,
    color: C.text,
  },
  radioLabelSelected: {
    color: C.primary,
    fontWeight: '600',
  },
});
