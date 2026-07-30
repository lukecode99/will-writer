import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, Guardian } from '../types';
import { shared } from './shared';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function Guardians({ data, onChange, onNext, onBack }: Props) {
  const unnamed = data.guardians.some(g => !g.name.trim());
  const skipping = data.guardians.length === 0;

  function addGuardian() {
    onChange({ guardians: [...data.guardians, { id: uid(), name: '', address: '' }] });
  }

  function updateGuardian(id: string, field: keyof Guardian, value: string) {
    onChange({
      guardians: data.guardians.map(g => g.id === id ? { ...g, [field]: value } : g),
    });
  }

  function removeGuardian(id: string) {
    onChange({ guardians: data.guardians.filter(g => g.id !== id) });
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Guardians</Text>
      <Text style={shared.sub}>
        Because you have children who may be under 18, you can appoint guardians to care for them if both parents die.
        This takes effect only while any child remains under 18.
      </Text>

      {data.guardians.map((g, i) => (
        <View key={g.id} style={shared.card}>
          <View style={shared.cardHeader}>
            <Text style={shared.cardTitle}>Guardian {i + 1}</Text>
            <TouchableOpacity style={shared.dangerBtn} onPress={() => removeGuardian(g.id)}>
              <Text style={shared.dangerBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
          <Text style={shared.label}>Full name</Text>
          <TextInput
            style={[shared.input, !g.name.trim() ? shared.inputError : null]}
            placeholder="Full legal name"
            value={g.name}
            onChangeText={v => updateGuardian(g.id, 'name', v)}
            autoCapitalize="words"
          />
          {!g.name.trim() ? (
            <Text style={shared.error}>
              A guardian with no name appoints nobody. Enter a name, or remove this guardian.
            </Text>
          ) : null}
          <Text style={shared.label}>Address</Text>
          <TextInput
            style={[shared.input, shared.inputMulti]}
            placeholder="Full address"
            value={g.address}
            onChangeText={v => updateGuardian(g.id, 'address', v)}
            multiline
            numberOfLines={2}
          />
        </View>
      ))}

      <TouchableOpacity style={shared.addBtn} onPress={addGuardian}>
        <Text style={shared.addBtnText}>+ Add a guardian</Text>
      </TouchableOpacity>

      {/* Skipping is allowed — it is a legitimate choice — but it used to be a
          plain button with no indication that anything followed from it. The
          consequence is decided by a court, so it is spelled out before the tap,
          not after. */}
      {skipping ? (
        <View style={styles.warnPanel}>
          <Text style={styles.warnTitle}>If you appoint nobody</Text>
          <Text style={styles.warnText}>
            You can continue without naming a guardian. If you do, and there is no
            surviving parent with parental responsibility, the family court decides
            who looks after your children under the Children Act 1989 — your wishes
            will not be on record for it to follow.
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[shared.primaryBtn, unnamed ? shared.btnDisabled : null]}
        onPress={() => { if (!unnamed) onNext(); }}
        disabled={unnamed}
      >
        <Text style={shared.primaryBtnText}>
          {skipping ? 'Skip (no guardians)' : 'Continue'}
        </Text>
      </TouchableOpacity>
      {unnamed ? (
        <Text style={shared.error}>Give every guardian a name, or remove the blank one, before continuing.</Text>
      ) : null}
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  warnPanel: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 12,
    marginTop: 18,
  },
  warnTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 4,
  },
  warnText: {
    fontSize: 12,
    color: '#92400E',
    lineHeight: 18,
  },
});
