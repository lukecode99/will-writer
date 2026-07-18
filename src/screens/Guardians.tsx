import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
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
            style={shared.input}
            placeholder="Full legal name"
            value={g.name}
            onChangeText={v => updateGuardian(g.id, 'name', v)}
            autoCapitalize="words"
          />
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

      <TouchableOpacity style={shared.primaryBtn} onPress={onNext}>
        <Text style={shared.primaryBtnText}>
          {data.guardians.length === 0 ? 'Skip (no guardians)' : 'Continue'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
