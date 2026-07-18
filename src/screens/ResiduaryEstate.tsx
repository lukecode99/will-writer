import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { WillData, Beneficiary } from '../types';
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

function totalPct(beneficiaries: Beneficiary[]): number {
  return beneficiaries.reduce((s, b) => s + (parseFloat(b.percentage) || 0), 0);
}

export default function ResiduaryEstate({ data, onChange, onNext, onBack }: Props) {
  function addBeneficiary() {
    onChange({
      beneficiaries: [...data.beneficiaries, { id: uid(), name: '', relationship: '', percentage: '' }],
    });
  }

  function updateBen(id: string, field: keyof Beneficiary, value: string) {
    onChange({
      beneficiaries: data.beneficiaries.map(b => b.id === id ? { ...b, [field]: value } : b),
    });
  }

  function removeBen(id: string) {
    onChange({ beneficiaries: data.beneficiaries.filter(b => b.id !== id) });
  }

  const total = totalPct(data.beneficiaries);
  const totalOk = data.beneficiaries.length > 0 && Math.abs(total - 100) < 0.01;

  function handleNext() {
    if (data.beneficiaries.length === 0) {
      alert('Add at least one beneficiary for your residuary estate.');
      return;
    }
    if (!totalOk) {
      alert(`Percentages must add up to 100%. Currently: ${total.toFixed(1)}%`);
      return;
    }
    onNext();
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Residuary Estate</Text>
      <Text style={shared.sub}>
        Your residuary estate is everything left after debts, expenses, and any specific gifts above.
        Split it between beneficiaries — percentages must total 100%.
      </Text>

      {data.beneficiaries.map((b, i) => (
        <View key={b.id} style={shared.card}>
          <View style={shared.cardHeader}>
            <Text style={shared.cardTitle}>Beneficiary {i + 1}</Text>
            <TouchableOpacity style={shared.dangerBtn} onPress={() => removeBen(b.id)}>
              <Text style={shared.dangerBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
          <Text style={shared.label}>Full name</Text>
          <TextInput
            style={shared.input}
            placeholder="Full legal name"
            value={b.name}
            onChangeText={v => updateBen(b.id, 'name', v)}
            autoCapitalize="words"
          />
          <Text style={shared.label}>Relationship</Text>
          <TextInput
            style={shared.input}
            placeholder="e.g. spouse, daughter, friend"
            value={b.relationship}
            onChangeText={v => updateBen(b.id, 'relationship', v)}
          />
          <Text style={shared.label}>Share (%)</Text>
          <TextInput
            style={shared.input}
            placeholder="e.g. 50"
            value={b.percentage}
            onChangeText={v => updateBen(b.id, 'percentage', v)}
            keyboardType="decimal-pad"
          />
        </View>
      ))}

      <TouchableOpacity style={shared.addBtn} onPress={addBeneficiary}>
        <Text style={shared.addBtnText}>+ Add a beneficiary</Text>
      </TouchableOpacity>

      {data.beneficiaries.length > 0 ? (
        <View style={{
          marginTop: 12, padding: 12, borderRadius: 10,
          backgroundColor: totalOk ? '#D1FAE5' : '#FEF3C7',
        }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: totalOk ? '#065F46' : '#92400E' }}>
            Total: {total.toFixed(1)}% {totalOk ? '✓' : `— need ${(100 - total).toFixed(1)}% more`}
          </Text>
        </View>
      ) : null}

      <Text style={shared.label}>Backup beneficiary</Text>
      <Text style={shared.hint}>
        If a beneficiary dies before you, their share passes to this person (or charity) instead.
      </Text>
      <TextInput
        style={shared.input}
        placeholder="Name, or 'divide equally between surviving beneficiaries'"
        value={data.residuaryBackup}
        onChangeText={v => onChange({ residuaryBackup: v })}
        autoCapitalize="sentences"
      />

      <TouchableOpacity style={shared.primaryBtn} onPress={handleNext}>
        <Text style={shared.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
