import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { WillData, SpecificGift } from '../types';
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

export default function SpecificGifts({ data, onChange, onNext, onBack }: Props) {
  function addGift() {
    onChange({
      specificGifts: [...data.specificGifts, { id: uid(), recipient: '', description: '', isCharity: false }],
    });
  }

  function updateGift(id: string, field: keyof SpecificGift, value: string | boolean) {
    onChange({
      specificGifts: data.specificGifts.map(g => g.id === id ? { ...g, [field]: value } : g),
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
            onChangeText={v => updateGift(gift.id, 'description', v)}
          />

          <Text style={shared.label}>Recipient</Text>
          <TextInput
            style={shared.input}
            placeholder="Full name, or charity name"
            value={gift.recipient}
            onChangeText={v => updateGift(gift.id, 'recipient', v)}
            autoCapitalize="words"
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
            <Switch
              value={gift.isCharity}
              onValueChange={v => updateGift(gift.id, 'isCharity', v)}
              thumbColor={gift.isCharity ? '#1B3A6B' : '#ccc'}
              trackColor={{ false: '#ddd', true: '#9BAFD1' }}
            />
            <Text style={{ marginLeft: 8, fontSize: 14, color: '#1A1A2E' }}>
              This is a charity
            </Text>
          </View>
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
