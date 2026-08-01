import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, Guardian, GuardianRole } from '../types';
import { C, shared } from './shared';
import { confirmDestructive } from '../platform';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

/** Deliberately short. The full picture has more cases than a wizard step can
 *  carry, so this covers the ones that account for nearly everybody and sends
 *  the rest to someone who can check. */
const WHO_HAS_PR = [
  'A mother always has it, automatically.',
  'A father has it if he was married to or in a civil partnership with the mother when the child was born, or married her later.',
  'An unmarried father has it if he is named on the birth certificate, for births registered in England and Wales from 1 December 2003 onwards.',
  'Adoptive parents have it. So does anyone with a parental responsibility agreement or a court order.',
  'A step-parent does not have it just by being married to the parent.',
];

export default function Guardians({ data, onChange, onNext, onBack }: Props) {
  const primaries = data.guardians.filter(g => g.role === 'primary');
  const substitutes = data.guardians.filter(g => g.role === 'substitute');

  const unnamed = data.guardians.some(g => !g.name.trim());
  const orphanSubstitutes = substitutes.length > 0 && primaries.length === 0;
  const blocked = unnamed || orphanSubstitutes;

  function addGuardian(role: GuardianRole) {
    onChange({ guardians: [...data.guardians, { id: uid(), name: '', address: '', role }] });
  }

  function updateGuardian(id: string, field: 'name' | 'address', value: string) {
    onChange({
      guardians: data.guardians.map(g => (g.id === id ? { ...g, [field]: value } : g)),
    });
  }

  function removeGuardian(id: string) {
    const g = data.guardians.find(x => x.id === id);
    const doRemove = () => onChange({ guardians: data.guardians.filter(x => x.id !== id) });
    // A blank row is scaffolding, not a decision — no ceremony to remove it.
    if (!g || (!g.name.trim() && !g.address.trim())) {
      doRemove();
      return;
    }
    confirmDestructive(
      `Remove ${g.name.trim() || 'this guardian'} as a guardian for your children?`,
      'Remove',
      doRemove,
    );
  }

  function renderGuardian(g: Guardian, i: number, label: string) {
    return (
      <View key={g.id} style={shared.card}>
        <View style={shared.cardHeader}>
          <Text style={shared.cardTitle}>{label} {i + 1}</Text>
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
    );
  }

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Guardians</Text>
      <Text style={shared.sub}>
        Because you have children who may be under 18, you can appoint guardians to care for them if both parents die.
        This takes effect only while any child remains under 18.
      </Text>

      {/* A note, not a question. Only someone with parental responsibility can
          appoint a guardian at all, but asking everyone to certify their own
          legal status in order to catch the few who lack it stops the many for
          the sake of the few — and a self-assessed answer is not sound enough
          to generate or suppress a clause on. The people it affects are told
          plainly, up front, and left to act on it. */}
      <View style={styles.infoPanel}>
        <Text style={styles.infoTitle}>You need parental responsibility to appoint a guardian</Text>
        <Text style={styles.infoText}>
          This is a legal status, not the same as being a parent or looking after the child day to
          day. Without it the appointment has no legal effect (Children Act 1989, section 5(3)) —
          the will still reads as though it appoints someone, but it does not.
        </Text>
        <View style={styles.infoSpacer} />
        {WHO_HAS_PR.map(line => (
          <View key={line} style={styles.infoRow}>
            <Text style={styles.infoMarker}>•</Text>
            <Text style={styles.infoText}>{line}</Text>
          </View>
        ))}
        <View style={styles.infoSpacer} />
        <Text style={styles.infoText}>
          If none of these clearly covers you, check before you sign. Parental responsibility can be
          obtained by agreement with the mother or by applying to the court, and a solicitor can
          advise on a child arrangements or special guardianship order.
        </Text>
      </View>

      <Text style={shared.sectionTitle}>First choice</Text>
      <Text style={shared.hint}>
        Appointed together. Name two if you want a couple to take the children on jointly —
        if one of them cannot act, the other carries on alone.
      </Text>

      {primaries.map((g, i) => renderGuardian(g, i, 'Guardian'))}

      <TouchableOpacity style={shared.addBtn} onPress={() => addGuardian('primary')}>
        <Text style={shared.addBtnText}>+ Add a first-choice guardian</Text>
      </TouchableOpacity>

      <Text style={shared.sectionTitle}>If none of them can act</Text>
      <Text style={shared.hint}>
        Optional. These are only appointed if every first choice above has died, or is unable or
        unwilling to act.
      </Text>

      {substitutes.map((g, i) => renderGuardian(g, i, 'Substitute'))}

      {orphanSubstitutes ? (
        <Text style={shared.error}>
          You have named a substitute but no first choice. A substitute only takes over from
          someone — add a first-choice guardian, or move this one up.
        </Text>
      ) : null}

      <TouchableOpacity style={shared.addBtn} onPress={() => addGuardian('substitute')}>
        <Text style={shared.addBtnText}>+ Add a substitute guardian</Text>
      </TouchableOpacity>

      {/* Skipping is allowed — it is a legitimate choice — but it used to be a
          plain button with no indication that anything followed from it. The
          consequence is decided by a court, so it is spelled out before the tap,
          not after. */}
      {primaries.length === 0 ? (
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
        style={[shared.primaryBtn, blocked ? shared.btnDisabled : null]}
        onPress={() => { if (!blocked) onNext(); }}
        disabled={blocked}
      >
        <Text style={shared.primaryBtnText}>
          {primaries.length === 0 ? 'Skip (no guardians)' : 'Continue'}
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
  infoPanel: {
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginTop: 14,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    marginBottom: 6,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  infoSpacer: {
    height: 8,
  },
  infoMarker: {
    width: 14,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },
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
