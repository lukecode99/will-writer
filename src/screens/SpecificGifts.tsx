import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, StyleSheet } from 'react-native';
import { WillData, SpecificGift, GiftSubstitutionType, GiftTaxBurden, NamedSubstituteFallback } from '../types';
import { blockingProblems } from '../validation';
import { knownPeople } from '../people';
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

const GIFT_SUB_OPTIONS: Array<{ value: GiftSubstitutionType; label: string; detail: string }> = [
  {
    value: 'residue',
    label: 'Falls into the residuary estate (default)',
    detail: 'The gift is added to everything else you leave and passes under your residuary estate.',
  },
  {
    value: 'per-stirpes',
    label: 'Their own children take it',
    detail: 'The gift passes equally to the recipient’s own children (per stirpes). Only if they leave no children does it fall into your residuary estate.',
  },
  {
    value: 'named',
    label: 'Passes to someone else',
    detail: 'You name one or more people who take the gift instead. Name more than one and they take it jointly.',
  },
];

// Where a named alternative's part goes if that alternative also dies first.
// Same choice as a residuary substitute, but the ultimate destination is the
// residuary estate rather than the other beneficiaries — a specific gift that
// fails all the way through has always fallen into residue.
const GIFT_FALLBACK_OPTIONS: Array<{ value: NamedSubstituteFallback; label: string; detail: string }> = [
  {
    value: 'survivors',
    label: 'The others take it',
    detail: 'Their part passes to the other people you’ve named here — or, if none of them survive you, the gift falls into your residuary estate.',
  },
  {
    value: 'issue',
    label: 'Their own children take it',
    detail: 'Their part passes equally to their own children (per stirpes). Only if they leave no children does it fall into your residuary estate.',
  },
];

// With a single named alternative there are no "others" for the gift to fall
// back to, so the survivors route collapses to exactly one outcome: it falls
// into the residuary estate — which is the clause the will already prints in
// that case. Relabel the option so the button describes what it does rather than
// pointing at an empty set. With two or more alternatives, "the others take it"
// is the truthful wording and is kept. The stored value stays 'survivors' either
// way, so the generated will is unchanged — this is a label fix only.
function giftFallbackOptions(count: number): Array<{ value: NamedSubstituteFallback; label: string; detail: string }> {
  if (count > 1) return GIFT_FALLBACK_OPTIONS;
  return GIFT_FALLBACK_OPTIONS.map(opt =>
    opt.value === 'survivors'
      ? {
          value: 'survivors' as NamedSubstituteFallback,
          label: 'Falls into your residuary estate',
          detail: 'There is no one else named to take it, so the gift is added to everything else you leave and passes under your residuary estate.',
        }
      : opt,
  );
}

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
          recipients: [{ id: uid(), name: '', address: '' }],
          description: '',
          isCharity: false,
          taxBurden: 'bearsOwnTax',
          substitutionType: 'residue',
          substitutionRecipients: [],
          substitutionFallback: 'survivors',
        },
      ],
    });
  }

  function updateGift(id: string, updates: Partial<SpecificGift>) {
    onChange({
      specificGifts: data.specificGifts.map(g => g.id === id ? { ...g, ...updates } : g),
    });
  }

  function addRecipient(gift: SpecificGift, name: string) {
    updateGift(gift.id, {
      recipients: [...gift.recipients, { id: uid(), name, address: '' }],
    });
  }

  function updateRecipient(gift: SpecificGift, rid: string, updates: Partial<{ name: string; address: string }>) {
    updateGift(gift.id, {
      recipients: gift.recipients.map(r => r.id === rid ? { ...r, ...updates } : r),
    });
  }

  function removeRecipient(gift: SpecificGift, rid: string) {
    const r = gift.recipients.find(x => x.id === rid);
    const doRemove = () => updateGift(gift.id, {
      recipients: gift.recipients.filter(x => x.id !== rid),
    });
    // A blank row is scaffolding, not a decision.
    if (!r || !r.name.trim()) {
      doRemove();
      return;
    }
    confirmDestructive(`Remove ${r.name.trim()} as a recipient of this gift?`, 'Remove', doRemove);
  }

  // The joint recipients as one readable label, for headings and confirmations.
  function recipientLabel(gift: SpecificGift): string {
    return gift.recipients.map(r => r.name.trim()).filter(Boolean).join(' and ');
  }

  function addGiftSub(gift: SpecificGift, name: string) {
    updateGift(gift.id, {
      substitutionRecipients: [...gift.substitutionRecipients, { id: uid(), name, address: '' }],
    });
  }

  function updateGiftSub(gift: SpecificGift, subId: string, updates: Partial<{ name: string; address: string }>) {
    updateGift(gift.id, {
      substitutionRecipients: gift.substitutionRecipients.map(s => s.id === subId ? { ...s, ...updates } : s),
    });
  }

  function removeGiftSub(gift: SpecificGift, subId: string) {
    const s = gift.substitutionRecipients.find(x => x.id === subId);
    const doRemove = () => updateGift(gift.id, {
      substitutionRecipients: gift.substitutionRecipients.filter(x => x.id !== subId),
    });
    // A blank row is scaffolding, not a decision.
    if (!s || !s.name.trim()) {
      doRemove();
      return;
    }
    confirmDestructive(`Remove ${s.name.trim()} as an alternative recipient?`, 'Remove', doRemove);
  }

  function removeGift(id: string) {
    const g = data.specificGifts.find(x => x.id === id);
    const doRemove = () => onChange({ specificGifts: data.specificGifts.filter(x => x.id !== id) });
    // A blank row is scaffolding, not a decision — no ceremony to remove it.
    const who = g ? recipientLabel(g) : '';
    if (!g || (!g.description.trim() && !who)) {
      doRemove();
      return;
    }
    confirmDestructive(
      `Remove the gift of ${g.description.trim() || 'this item'}${who ? ` to ${who}` : ''}?`,
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

  // Anyone the will already knows about — partner and children — offered as a
  // one-tap chip on the named-alternative list, exactly as the residuary screen
  // does. Typing a name by hand is always allowed too; the chips exist for the
  // people the app cannot know about, like a stepchild or a friend.
  const known = knownPeople(data);

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

          <Text style={shared.label}>Recipient(s)</Text>
          <Text style={shared.hint}>
            Name more than one person and they take the gift jointly — if one dies before you, the
            other(s) take the whole gift, and any alternative below only applies if none of them survive you.
          </Text>
          {gift.recipients.map(r => (
            <View key={r.id} style={styles.subCard}>
              <View style={styles.subRow}>
                <TextInput
                  style={[shared.input, { flex: 1 }, !r.name.trim() ? styles.inputError : null]}
                  placeholder="Full name, or charity name"
                  value={r.name}
                  onChangeText={v => updateRecipient(gift, r.id, { name: v })}
                  autoCapitalize="words"
                />
                {gift.recipients.length > 1 ? (
                  <TouchableOpacity style={styles.subRemove} onPress={() => removeRecipient(gift, r.id)}>
                    <Text style={shared.dangerBtnText}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {/* Optional, like every other name in the will — a bare name is a
                  search, and executors are the ones who run it. */}
              <TextInput
                style={[shared.input, shared.inputMulti]}
                placeholder="Their address (optional — helps your executors identify them)"
                value={r.address}
                onChangeText={v => updateRecipient(gift, r.id, { address: v })}
                multiline
                numberOfLines={2}
              />
            </View>
          ))}
          {gift.recipients.some(r => !r.name.trim()) ? (
            <Text style={styles.errorText}>Say who receives it, or remove this gift.</Text>
          ) : null}

          <Text style={[shared.hint, styles.addMorePrompt]}>
            Add more beneficiaries if this is a jointly shared gift:
          </Text>
          <View style={styles.chipRow}>
            {known
              .filter(p => !gift.recipients.some(r => r.name.trim().toLowerCase() === p.name.trim().toLowerCase()))
              .map(p => (
                <TouchableOpacity key={p.ref} style={styles.chip} onPress={() => addRecipient(gift, p.name)}>
                  <Text style={styles.chipText}>+ {p.name}</Text>
                  <Text style={styles.chipRel}>{p.relationship}</Text>
                </TouchableOpacity>
              ))}
            <TouchableOpacity style={styles.chip} onPress={() => addRecipient(gift, '')}>
              <Text style={styles.chipText}>+ Add another recipient</Text>
            </TouchableOpacity>
          </View>

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
            {gift.recipients.filter(r => r.name.trim()).length > 1
              ? 'If none of them survive you'
              : `If ${recipientLabel(gift) || 'the recipient'} doesn't survive you`}
          </Text>
          <View style={styles.radioGroup}>
            {GIFT_SUB_OPTIONS
              // Per stirpes is meaningless for a charity — it has no children —
              // and ambiguous with several recipients (whose children?), so it
              // is withheld in both cases, unless a saved draft already chose it,
              // in which case it is shown so the screen reflects the will as it
              // stands and validation is what objects.
              .filter(opt => opt.value !== 'per-stirpes'
                || gift.substitutionType === 'per-stirpes'
                || (!gift.isCharity && gift.recipients.filter(r => r.name.trim()).length <= 1))
              .map(opt => {
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
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{opt.label}</Text>
                      <Text style={styles.radioDetail}>{opt.detail}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
          </View>

          {gift.substitutionType === 'named' && (
            <>
              {gift.substitutionRecipients.map(s => (
                <View key={s.id} style={styles.subCard}>
                  <View style={styles.subRow}>
                    <TextInput
                      style={[shared.input, { flex: 1 }, !s.name.trim() ? styles.inputError : null]}
                      placeholder="Full name or charity name"
                      value={s.name}
                      onChangeText={v => updateGiftSub(gift, s.id, { name: v })}
                      autoCapitalize="words"
                    />
                    <TouchableOpacity style={styles.subRemove} onPress={() => removeGiftSub(gift, s.id)}>
                      <Text style={shared.dangerBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Optional. A substitute may never inherit, so the gift is not
                      blocked over their address — but a bare name is a search,
                      and executors are the ones who run it. */}
                  <TextInput
                    style={[shared.input, shared.inputMulti]}
                    placeholder="Their address (optional — helps your executors identify them)"
                    value={s.address}
                    onChangeText={v => updateGiftSub(gift, s.id, { address: v })}
                    multiline
                    numberOfLines={2}
                  />
                </View>
              ))}

              {gift.substitutionRecipients.some(s => !s.name.trim()) ? (
                <Text style={styles.errorText}>
                  Name each alternative recipient, or remove the row.
                </Text>
              ) : null}
              {gift.substitutionRecipients.length === 0 ? (
                <Text style={styles.errorText}>
                  Add an alternative recipient, or choose "falls into the residuary estate" above.
                </Text>
              ) : null}

              <View style={styles.chipRow}>
                {known
                  .filter(p => !gift.substitutionRecipients.some(s => s.name.trim().toLowerCase() === p.name.trim().toLowerCase()))
                  .map(p => (
                    <TouchableOpacity key={p.ref} style={styles.chip} onPress={() => addGiftSub(gift, p.name)}>
                      <Text style={styles.chipText}>+ {p.name}</Text>
                      <Text style={styles.chipRel}>{p.relationship}</Text>
                    </TouchableOpacity>
                  ))}
                <TouchableOpacity style={styles.chip} onPress={() => addGiftSub(gift, '')}>
                  <Text style={styles.chipText}>+ Someone else</Text>
                </TouchableOpacity>
              </View>

              {gift.substitutionRecipients.length > 0 ? (
                <>
                  <Text style={[shared.label, { marginTop: 14 }]}>
                    {gift.substitutionRecipients.length > 1
                      ? 'If one of these people dies before you too'
                      : `If ${gift.substitutionRecipients[0].name.trim() || 'this person'} dies before you too`}
                  </Text>
                  <View style={styles.radioGroup}>
                    {giftFallbackOptions(gift.substitutionRecipients.length).map(opt => {
                      const selected = gift.substitutionFallback === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.radioOption, selected && styles.radioOptionSelected]}
                          onPress={() => updateGift(gift.id, { substitutionFallback: opt.value })}
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
                </>
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
  addMorePrompt: {
    marginTop: 12,
    marginBottom: 2,
    fontWeight: '600',
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
  subCard: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    gap: 8,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  subRemove: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.primary,
    backgroundColor: '#EEF2FA',
  },
  chipText: {
    fontSize: 13.5,
    color: C.primary,
    fontWeight: '600',
  },
  chipRel: {
    fontSize: 11.5,
    color: C.textLight,
  },
});
