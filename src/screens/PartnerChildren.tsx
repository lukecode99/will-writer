import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, Child } from '../types';
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

export default function PartnerChildren({ data, onChange, onNext, onBack }: Props) {
  const hasPartner = !!(data.partnerName || data.partnerAddress);

  function addChild() {
    onChange({ children: [...data.children, { id: uid(), name: '', dob: '' }] });
  }

  function updateChild(id: string, field: keyof Child, value: string) {
    onChange({
      children: data.children.map(c => c.id === id ? { ...c, [field]: value } : c),
    });
  }

  function removeChild(id: string) {
    onChange({ children: data.children.filter(c => c.id !== id) });
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Partner &amp; Children</Text>
      <Text style={shared.sub}>Tell us about your family so we can structure your Will correctly.</Text>

      <Text style={shared.sectionTitle}>Partner</Text>
      <Text style={shared.hint}>Leave blank if you have no partner.</Text>

      <Text style={shared.label}>Partner's full name</Text>
      <TextInput
        style={shared.input}
        placeholder="Full legal name"
        value={data.partnerName}
        onChangeText={v => onChange({ partnerName: v })}
        autoCapitalize="words"
      />

      {hasPartner || data.partnerName ? (
        <>
          <Text style={shared.label}>Partner's address</Text>
          <TextInput
            style={[shared.input, shared.inputMulti]}
            placeholder="Address (if different from yours)"
            value={data.partnerAddress}
            onChangeText={v => onChange({ partnerAddress: v })}
            multiline
            numberOfLines={2}
          />
        </>
      ) : null}

      <Text style={shared.sectionTitle}>Children</Text>
      <Text style={shared.hint}>Include all biological, adopted, and step-children. We use date of birth to determine whether guardians are needed.</Text>

      {data.children.map((child, i) => (
        <View key={child.id} style={shared.card}>
          <View style={shared.cardHeader}>
            <Text style={shared.cardTitle}>Child {i + 1}</Text>
            <TouchableOpacity style={shared.dangerBtn} onPress={() => removeChild(child.id)}>
              <Text style={shared.dangerBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
          <Text style={shared.label}>Full name</Text>
          <TextInput
            style={shared.input}
            placeholder="Child's full name"
            value={child.name}
            onChangeText={v => updateChild(child.id, 'name', v)}
            autoCapitalize="words"
          />
          <Text style={shared.label}>Date of birth (DD/MM/YYYY)</Text>
          <TextInput
            style={shared.input}
            placeholder="DD/MM/YYYY"
            value={child.dob}
            onChangeText={v => updateChild(child.id, 'dob', v)}
            keyboardType="numbers-and-punctuation"
          />
        </View>
      ))}

      <TouchableOpacity style={shared.addBtn} onPress={addChild}>
        <Text style={shared.addBtnText}>+ Add a child</Text>
      </TouchableOpacity>

      <TouchableOpacity style={shared.primaryBtn} onPress={onNext}>
        <Text style={shared.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
