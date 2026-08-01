import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet } from 'react-native';
import { WillData, SpecificGift, GiftSubstitutionType, GiftTaxBurden } from '../types';
import { blockingProblems } from '../validation';
import { notify, confirmDestructive } from '../platform';
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

const TAX_OPTIONS: Array<{ value: GiftTaxBurden; label: string; detail: string }> = [
  {
    value: 'bearsOwnTax',
    label: 'The recipient pays the tax on it (recommended)',
    detail: 'Any inheritance tax on this gift comes out of the gift itself. Everything you leave in the residuary estate is protected.',
  },
  {
    value: 'freeOfTax',
    label: 'My estate pays the tax on it ("free of tax")',
    detail: 'The recipient gets the full value and the tax is paid from your residuary estate instead — so it comes out of your residuary beneficiaries’ shares.',
  },
];

export default function SpecificGifts({ data, onChange, onNext, onBack }: Props) {
  function addGift() {
    onChange({
      specificGifts: [
        ...data.specificGifts,
        {
          id: uid(),
          recipient: '',
          description: '',
          isCharity: false,
          taxBurden: 'bearsOwnTax',
          substitutionType: 'residue',
          substitutionRecipient: '',
        },
      ],
    });
  }

  function updateGift(id: string, updates: Partial<SpecificGift>) {
    onChange({
      specificGifts: data.specificGifts.map(g => g.id === id ? { ...g, ...updates } : g),
    });
  }

  function removeGift(id: string) {
    const g = data.specificGifts.find(x => x.id === id);
    const doRemove = () => onChange({ specificGifts: data.specificGifts.filter(x => x.id !== id) });
    // A blank row is scaffolding, not a decision — no ceremony to remove it.
    if (!g || (!g.description.trim() && !g.recipient.trim())) {
      doRemove();
      return;
    }
    confirmDestructive(
      `Remove the gift of ${g.description.trim() || 'this item'}${g.recipient.trim() ? ` to ${g.recipient.trim()}` : ''}?`,
      'Remove',
      doRemove,
    );
  }

  /**
   * Skipping this step entirely is fine. A half-filled gift is not: "I give
   * to " with nothing after it is a clause that a court has to construe, and the
   * usual answer is that it fails and the item drops into the residue silently.
   */
  function handleNext() {
    const problems = blockingProblems(data).filter(p => p.step === 'gifts');
    if (problems.length > 0) {
      notify(problems.map(p => `• ${p.message}`).join('\n'), 'Not finished yet');
      return;
    }
    onNext();
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
            style={[shared.input, !gift.description.trim() ? styles.inputError : null]}
            placeholder="e.g. £5,000 in cash / my vintage watch"
            value={gift.description}
            onChangeText={v => updateGift(gift.id, { description: v })}
          />
          {!gift.description.trim() ? (
            <Text style={styles.errorText}>Say what the gift is, or remove this gift.</Text>
          ) : null}

          <Text style={shared.label}>Recipient</Text>
          <TextInput
            style={[shared.input, !gift.recipient.trim() ? styles.inputError : null]}
            placeholder="Full name, or charity name"
            value={gift.recipient}
            onChangeText={v => updateGift(gift.id, { recipient: v })}
            autoCapitalize="words"
          />
          {!gift.recipient.trim() ? (
            <Text style={styles.errorText}>Say who receives it, or remove this gift.</Text>
          ) : null}

          <View style={styles.switchRow}>
            <Switch
              value={gift.isCharity}
              onValueChange={v => updateGift(gift.id, { isCharity: v })}
              thumbColor={gift.isCharity ? C.primary : '#ccc'}
              trackColor={{ false: '#ddd', true: '#9BAFD1' }}
            />
            <Text style={styles.switchLabel}>This is a charity</Text>
          </View>

          {gift.isCharity ? (
            <Text style={[shared.hint, { marginTop: 12 }]}>
              Gifts to a UK registered charity are exempt from inheritance tax (IHTA 1984 s.23),
              so there is no tax on this gift to allocate.
            </Text>
          ) : (
            <>
              <Text style={[shared.label, { marginTop: 16 }]}>Who pays the inheritance tax on this gift?</Text>
              <View style={styles.radioGroup}>
                {TAX_OPTIONS.map(opt => {
                  const selected = (gift.taxBurden ?? 'bearsOwnTax') === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.radioOption, selected && styles.radioOptionSelected]}
                      onPress={() => updateGift(gift.id, { taxBurden: opt.value })}
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

              {(gift.taxBurden ?? 'bearsOwnTax') === 'freeOfTax' && (
                <View style={styles.warnBox}>
                  <Text style={styles.warnText}>
                    Worth knowing: choosing "free of tax" also grosses the tax up, so your estate pays
                    more inheritance tax overall. And if your residuary estate is too small to cover it —
                    which is easy to happen if this gift is a large one, like a house — the gift is cut
                    down anyway to pay the tax, after your residuary beneficiaries have already been
                    wiped out. Your will explains this in the Inheritance Tax clause.
                  </Text>
                </View>
              )}
            </>
          )}

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
                style={[shared.input, !gift.substitutionRecipient.trim() ? styles.inputError : null]}
                placeholder="Full name or charity name"
                value={gift.substitutionRecipient}
                onChangeText={v => updateGift(gift.id, { substitutionRecipient: v })}
                autoCapitalize="words"
              />
              {!gift.substitutionRecipient.trim() ? (
                <Text style={styles.errorText}>
                  Name the alternative recipient, or choose "falls into the residuary estate" above.
                </Text>
              ) : null}
            </>
          )}
        </View>
      ))}

      <TouchableOpacity style={shared.addBtn} onPress={addGift}>
        <Text style={shared.addBtnText}>+ Add a specific gift</Text>
      </TouchableOpacity>

      <TouchableOpacity style={shared.primaryBtn} onPress={handleNext}>
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
  inputError: {
    borderColor: C.danger,
  },
  errorText: {
    color: C.danger,
    fontSize: 12.5,
    marginTop: 4,
  },
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
  radioDetail: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 3,
    lineHeight: 17,
  },
  warnBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E4C77A',
    backgroundColor: '#FDF6E3',
  },
  warnText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: '#6B5216',
  },
});
