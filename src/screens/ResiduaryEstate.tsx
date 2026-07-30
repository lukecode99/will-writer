import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet } from 'react-native';
import { WillData, Beneficiary, SubstitutionType } from '../types';
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

function totalPct(beneficiaries: Beneficiary[]): number {
  return beneficiaries.reduce((s, b) => s + (parseFloat(b.percentage) || 0), 0);
}

function proRataResult(
  beneficiaries: Beneficiary[],
  deceasedId: string,
): Array<{ name: string; pct: number }> {
  const survivors = beneficiaries.filter(b => b.id !== deceasedId && (parseFloat(b.percentage) || 0) > 0);
  const totalSurvivor = survivors.reduce((s, b) => s + (parseFloat(b.percentage) || 0), 0);
  if (totalSurvivor === 0 || survivors.length === 0) return [];
  return survivors.map(b => ({
    name: b.name || '(unnamed)',
    pct: ((parseFloat(b.percentage) || 0) / totalSurvivor) * 100,
  }));
}

function previewText(b: Beneficiary, allBens: Beneficiary[]): string {
  const name = b.name || 'this person';
  const pct = b.percentage || '?';
  const sub = b.substitution;
  switch (sub.type) {
    case 'per-stirpes':
      return `If ${name} dies before you, their ${pct}% passes equally to their own children (per stirpes). If they have no children, the share is divided among the other surviving beneficiaries.`;
    case 'named': {
      const target = sub.namedPerson || '(name not yet entered)';
      return `If ${name} dies before you, their ${pct}% passes to ${target}.`;
    }
    case 'pro-rata': {
      const others = proRataResult(allBens, b.id);
      if (others.length === 0) {
        return `If ${name} dies before you, their ${pct}% would go to surviving co-beneficiaries — but there are none yet.`;
      }
      const parts = others.map(o => `${o.name} (${o.pct.toFixed(1)}%)`).join(', ');
      return `If ${name} dies before you, their ${pct}% is divided pro-rata among the other beneficiaries: ${parts}.`;
    }
  }
}

const SUB_OPTIONS: Array<{ value: SubstitutionType; label: string; detail: string }> = [
  {
    value: 'per-stirpes',
    label: 'Their children equally',
    detail: 'Passes to their own children in equal shares (per stirpes). Default under Wills Act 1837 s.33 for your own children.',
  },
  {
    value: 'named',
    label: 'A named person or charity',
    detail: 'Their share goes to a specific person or charity you name.',
  },
  {
    value: 'pro-rata',
    label: 'Pro-rata among survivors',
    detail: 'Their share is divided among the other beneficiaries in proportion to their existing shares.',
  },
];

export default function ResiduaryEstate({ data, onChange, onNext, onBack }: Props) {
  function addBeneficiary() {
    onChange({
      beneficiaries: [
        ...data.beneficiaries,
        {
          id: uid(),
          name: '',
          relationship: '',
          percentage: '',
          isOwnChild: false,
          isMinor: false,
          substitution: { type: 'per-stirpes', namedPerson: '' },
        },
      ],
    });
  }

  function updateBen(id: string, updates: Partial<Beneficiary>) {
    onChange({
      beneficiaries: data.beneficiaries.map(b => b.id === id ? { ...b, ...updates } : b),
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
        Your residuary estate is everything left after debts, expenses, and any specific gifts.
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
            onChangeText={v => updateBen(b.id, { name: v })}
            autoCapitalize="words"
          />

          <Text style={shared.label}>Relationship</Text>
          <TextInput
            style={shared.input}
            placeholder="e.g. spouse, daughter, friend"
            value={b.relationship}
            onChangeText={v => updateBen(b.id, { relationship: v })}
          />

          <Text style={shared.label}>Share (%)</Text>
          <TextInput
            style={shared.input}
            placeholder="e.g. 50"
            value={b.percentage}
            onChangeText={v => updateBen(b.id, { percentage: v })}
            keyboardType="decimal-pad"
          />

          <View style={styles.toggleRow}>
            <Switch
              value={b.isOwnChild}
              onValueChange={v => updateBen(b.id, { isOwnChild: v })}
              thumbColor={b.isOwnChild ? C.primary : '#ccc'}
              trackColor={{ false: '#ddd', true: '#9BAFD1' }}
            />
            <Text style={styles.toggleLabel}>This is my child</Text>
          </View>

          <View style={styles.toggleRow}>
            <Switch
              value={b.isMinor}
              onValueChange={v => updateBen(b.id, { isMinor: v })}
              thumbColor={b.isMinor ? C.primary : '#ccc'}
              trackColor={{ false: '#ddd', true: '#9BAFD1' }}
            />
            <Text style={styles.toggleLabel}>This beneficiary is under 18</Text>
          </View>

          <Text style={[shared.label, { marginTop: 16 }]}>If {b.name || 'this person'} dies before you</Text>
          <Text style={shared.hint}>Choose what happens to their share.</Text>

          <View style={styles.radioGroup}>
            {SUB_OPTIONS.map(opt => {
              const selected = b.substitution.type === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.radioOption, selected && styles.radioOptionSelected]}
                  onPress={() => updateBen(b.id, { substitution: { ...b.substitution, type: opt.value } })}
                >
                  <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
                    {selected && <View style={styles.radioInner} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{opt.label}</Text>
                    <Text style={styles.radioDetail}>{opt.detail}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {b.substitution.type === 'named' && (
            <>
              <Text style={shared.label}>Name of substitute recipient</Text>
              <TextInput
                style={shared.input}
                placeholder="Full name or charity name"
                value={b.substitution.namedPerson}
                onChangeText={v => updateBen(b.id, { substitution: { ...b.substitution, namedPerson: v } })}
                autoCapitalize="words"
              />
            </>
          )}

          {b.isOwnChild && b.substitution.type !== 'per-stirpes' && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️ Warning: Section 33 of the Wills Act 1837 automatically passes a deceased child's share to
                their children. By choosing a different substitution you override this and disinherit{b.name ? ` ${b.name}'s` : ''} children.
                This may not be your intention — consider consulting a solicitor.
              </Text>
            </View>
          )}

          <View style={styles.previewBox}>
            <Text style={styles.previewText}>{previewText(b, data.beneficiaries)}</Text>
          </View>
        </View>
      ))}

      <TouchableOpacity style={shared.addBtn} onPress={addBeneficiary}>
        <Text style={shared.addBtnText}>+ Add a beneficiary</Text>
      </TouchableOpacity>

      {data.beneficiaries.length > 0 ? (
        <View style={[styles.totalBar, { backgroundColor: totalOk ? '#D1FAE5' : '#FEF3C7' }]}>
          <Text style={[styles.totalText, { color: totalOk ? '#065F46' : '#92400E' }]}>
            Total: {total.toFixed(1)}% {totalOk ? '✓' : `— need ${(100 - total).toFixed(1)}% more`}
          </Text>
        </View>
      ) : null}

      <Text style={[shared.sectionTitle, { marginTop: 28 }]}>If nobody survives</Text>
      <Text style={shared.sub}>
        If no beneficiary — and none of their substitutes — survives you by 30 days, who should receive the estate?
        Name a charity or a wider family member to prevent partial intestacy.
      </Text>
      <TextInput
        style={shared.input}
        placeholder="e.g. Cancer Research UK, or a cousin's full name"
        value={data.ultimateBackstop}
        onChangeText={v => onChange({ ultimateBackstop: v })}
        autoCapitalize="sentences"
      />
      {!data.ultimateBackstop && (
        <Text style={shared.hint}>
          If left blank, the estate would pass under the rules of intestacy — this may not match your wishes.
        </Text>
      )}

      <TouchableOpacity style={shared.primaryBtn} onPress={handleNext}>
        <Text style={shared.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  toggleLabel: {
    marginLeft: 10,
    fontSize: 14,
    color: C.text,
  },
  radioGroup: {
    marginTop: 6,
    gap: 8,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    marginTop: 2,
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
    fontWeight: '600',
    color: C.text,
  },
  radioLabelSelected: {
    color: C.primary,
  },
  radioDetail: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
    lineHeight: 16,
  },
  warningBox: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  warningText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 17,
  },
  previewBox: {
    backgroundColor: '#F0F4FF',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  previewText: {
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 17,
    fontStyle: 'italic',
  },
  totalBar: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  totalText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
