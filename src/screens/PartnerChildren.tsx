import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, Child } from '../types';
import { dobError, parseUkDate, ageInYears, childrenSummary, formatUkDateInput } from '../family';
import { shared, C } from './shared';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

/**
 * A child's date of birth is optional — leaving it blank is treated as "may be
 * under 18", which keeps the guardians step visible. What is not acceptable is a
 * date that looks accepted but is not real: "31/02/2020" used to roll silently
 * to 2 March, and "1/1/90" was read as 1990, making a 36-year-old, which
 * quietly removed the guardians step.
 */
function childDobError(dob: string): string {
  if (!dob.trim()) return '';
  const problem = dobError(dob);
  if (problem) return problem;
  return '';
}

/**
 * Shows the age we derived, because the consequence of getting it wrong is
 * invisible otherwise: an adult child silently removes the guardians step.
 * "1/1/90" is a real date and passes validation — reading back "aged 36" is what
 * tells a parent it was read as 1990 rather than 2090.
 */
function ageHint(dob: string): string {
  if (!dob.trim()) {
    return 'Optional. If left blank we assume this child may be under 18 and will ask you to appoint guardians.';
  }
  const parsed = parseUkDate(dob);
  if (!parsed) return '';
  const age = ageInYears(parsed);
  return age < 18
    ? `Aged ${age} — a minor, so we will ask you to appoint guardians.`
    : `Aged ${age} — an adult, so no guardian is needed for this child.`;
}

export default function PartnerChildren({ data, onChange, onNext, onBack }: Props) {
  const hasPartner = !!(data.partnerName || data.partnerAddress);
  const dobProblems = data.children.map(child => childDobError(child.dob));
  const canContinue = dobProblems.every(problem => !problem) && data.childrenConfirmed;

  /**
   * Adding or removing a child un-answers the question, because the list that
   * was confirmed is not the list on screen any more.
   *
   * Renaming one deliberately does not. A rename is the same people spelled
   * correctly, and clearing the tick on every keystroke would make correcting a
   * typo feel like an accusation.
   */
  function addChild() {
    onChange({
      children: [...data.children, { id: uid(), name: '', dob: '' }],
      childrenConfirmed: false,
    });
  }

  function updateChild(id: string, field: keyof Child, value: string) {
    onChange({
      children: data.children.map(c => c.id === id ? { ...c, [field]: value } : c),
    });
  }

  function removeChild(id: string) {
    onChange({
      children: data.children.filter(c => c.id !== id),
      childrenConfirmed: false,
    });
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
      {/* Who counts is settled in the confirmation below, where the list can
          actually be read back. Saying it twice invites the two to drift apart. */}
      <Text style={shared.hint}>Add each of your children. We use date of birth to work out whether guardians are needed.</Text>

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
            style={[shared.input, dobProblems[i] ? shared.inputError : null]}
            placeholder="DD/MM/YYYY"
            value={child.dob}
            onChangeText={v => updateChild(child.id, 'dob', formatUkDateInput(v))}
            keyboardType="numbers-and-punctuation"
          />
          {dobProblems[i]
            ? <Text style={shared.error}>{dobProblems[i]}</Text>
            : <Text style={shared.hint}>{ageHint(child.dob)}</Text>}
        </View>
      ))}

      <TouchableOpacity style={shared.addBtn} onPress={addChild}>
        <Text style={shared.addBtnText}>+ Add a child</Text>
      </TouchableOpacity>

      {/*
        Placed here, below the list and above Continue, rather than with the
        hint at the top. At the top there is nothing to check it against; here
        the list exists and can be read back. It is the last thing between this
        step and the rest of the will for the same reason.
      */}
      <View style={styles.confirmCard}>
        <Text style={styles.confirmSummary}>{childrenSummary(data.children)}</Text>
        <Text style={styles.confirmBody}>
          Include every child you have — adopted children, children from an earlier relationship,
          and adult children who are financially independent. A child you leave out can apply to
          the court for provision from your estate, and you will not be there to explain your
          reasons. A step-child is not legally your child unless you have adopted them — add one
          only if you want them treated the same as your own.
        </Text>
        <TouchableOpacity
          style={styles.confirmRow}
          onPress={() => onChange({ childrenConfirmed: !data.childrenConfirmed })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: data.childrenConfirmed }}
        >
          <View style={[styles.box, data.childrenConfirmed ? styles.boxChecked : null]}>
            {data.childrenConfirmed ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <Text style={styles.confirmLabel}>
            {data.children.length === 0
              ? 'I confirm I have no children.'
              : 'I confirm this is every child I have.'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[shared.primaryBtn, canContinue ? null : shared.btnDisabled]}
        onPress={() => { if (canContinue) onNext(); }}
        disabled={!canContinue}
      >
        <Text style={shared.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
      <TouchableOpacity style={shared.secondaryBtn} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  confirmCard: {
    backgroundColor: '#FFF8E6',
    borderWidth: 1,
    borderColor: '#E5C76B',
    borderRadius: 10,
    padding: 16,
    marginTop: 8,
    marginBottom: 20,
  },
  confirmSummary: {
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
  },
  confirmBody: {
    fontSize: 13,
    lineHeight: 19,
    color: C.textLight,
    marginBottom: 14,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: C.primary,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  boxChecked: {
    backgroundColor: C.primary,
  },
  tick: {
    color: C.surface,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  confirmLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: C.text,
  },
});
