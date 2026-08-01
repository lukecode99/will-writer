import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { WillData, Executor } from '../types';
import { blockingProblems } from '../validation';
import { C, shared } from './shared';
import { notify, confirmDestructive } from '../platform';

interface Props {
  data: WillData;
  onChange: (u: Partial<WillData>) => void;
  onNext: () => void;
  onBack: () => void;
}

function ExecForm({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: Executor;
  onChange: (v: Executor) => void;
}) {
  return (
    <View style={shared.card}>
      <Text style={shared.cardTitle}>{label}</Text>
      {hint ? <Text style={shared.hint}>{hint}</Text> : null}
      <Text style={shared.label}>Full name</Text>
      <TextInput
        style={shared.input}
        placeholder="Full legal name"
        value={value.name}
        onChangeText={name => onChange({ ...value, name })}
        autoCapitalize="words"
      />
      <Text style={shared.label}>Address</Text>
      <TextInput
        style={[shared.input, shared.inputMulti]}
        placeholder="Full address"
        value={value.address}
        onChangeText={address => onChange({ ...value, address })}
        multiline
        numberOfLines={2}
      />
    </View>
  );
}

export default function Executors({ data, onChange, onNext, onBack }: Props) {
  const [showSecondary, setShowSecondary] = React.useState(!!(data.secondaryExecutor.name));
  const [showBackup, setShowBackup] = React.useState(!!(data.backupExecutor.name));

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Executors</Text>
      <Text style={shared.sub}>
        Your executor manages your estate after you die — paying debts, applying for probate, and distributing assets. Choose someone you trust deeply.
      </Text>

      <ExecForm
        label="Primary Executor *"
        hint="Often a spouse, sibling, or close friend. Can also be a solicitor."
        value={data.primaryExecutor}
        onChange={v => onChange({ primaryExecutor: v })}
      />

      {showSecondary ? (
        <>
          <ExecForm
            label="Secondary Executor (optional)"
            hint="Acts jointly with your first executor, or steps in only if they cannot act — you choose which below."
            value={data.secondaryExecutor}
            onChange={v => onChange({ secondaryExecutor: v })}
          />
          {/* The appointment is a different appointment depending on the answer,
              and the will used to paper over the gap with a bracketed marker.
              Now the document refuses to finalise until this is answered, so
              the question has to be on the screen that creates the need. */}
          {data.secondaryExecutor.name.trim() ? (
            <View style={shared.card}>
              <Text style={shared.cardTitle}>How should {data.secondaryExecutor.name.trim()} act? *</Text>
              {([
                {
                  value: 'joint',
                  title: 'Jointly with the first executor',
                  detail: 'Both are executors from the start and act together.',
                },
                {
                  value: 'substitute',
                  title: 'Only as a substitute',
                  detail: `Steps in only if ${data.primaryExecutor.name.trim() || 'your first executor'} is unable or unwilling to act.`,
                },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.roleOption, data.secondaryExecutorRole === opt.value ? styles.roleOptionActive : null]}
                  onPress={() => onChange({ secondaryExecutorRole: opt.value })}
                >
                  <Text style={[styles.roleTitle, data.secondaryExecutorRole === opt.value ? styles.roleTitleActive : null]}>
                    {opt.title}
                  </Text>
                  <Text style={styles.roleDetail}>{opt.detail}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {/* Once opened, this form could never be closed again — the only
              way to withdraw a second executor was to blank both fields and
              live with the empty card. */}
          <TouchableOpacity
            style={styles.removeLink}
            onPress={() => {
              const clear = () => {
                onChange({
                  secondaryExecutor: { ...data.secondaryExecutor, name: '', address: '' },
                  secondaryExecutorRole: '',
                });
                setShowSecondary(false);
              };
              if (!data.secondaryExecutor.name.trim() && !data.secondaryExecutor.address.trim()) {
                clear();
                return;
              }
              confirmDestructive(
                `Remove ${data.secondaryExecutor.name.trim() || 'the second executor'} as an executor?`,
                'Remove',
                clear,
              );
            }}
          >
            <Text style={styles.removeLinkText}>Remove this executor</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity style={shared.addBtn} onPress={() => setShowSecondary(true)}>
          <Text style={shared.addBtnText}>+ Add a second executor</Text>
        </TouchableOpacity>
      )}

      {showBackup ? (
        <>
          <ExecForm
            label="Backup Executor (optional)"
            hint="Appointed only if neither primary nor secondary can act."
            value={data.backupExecutor}
            onChange={v => onChange({ backupExecutor: v })}
          />
          <TouchableOpacity
            style={styles.removeLink}
            onPress={() => {
              const clear = () => {
                onChange({ backupExecutor: { ...data.backupExecutor, name: '', address: '' } });
                setShowBackup(false);
              };
              if (!data.backupExecutor.name.trim() && !data.backupExecutor.address.trim()) {
                clear();
                return;
              }
              confirmDestructive(
                `Remove ${data.backupExecutor.name.trim() || 'the backup executor'} as an executor?`,
                'Remove',
                clear,
              );
            }}
          >
            <Text style={styles.removeLinkText}>Remove this executor</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={[shared.addBtn, { marginTop: 8 }]}
          onPress={() => setShowBackup(true)}
        >
          <Text style={shared.addBtnText}>+ Add a backup executor</Text>
        </TouchableOpacity>
      )}

      {/* An address with no name against it is the one that used to get through:
          the extra executor form gets opened, an address typed, the name left
          blank, and the will then appoints an unnamed person at a real address. */}
      {[data.secondaryExecutor, data.backupExecutor].some(e => e.address.trim() && !e.name.trim()) ? (
        <Text style={shared.error}>
          One of the extra executors has an address but no name. Give them a name, or clear the address.
        </Text>
      ) : null}

      <TouchableOpacity
        style={shared.primaryBtn}
        onPress={() => {
          const problems = blockingProblems(data).filter(p => p.step === 'executors');
          if (problems.length > 0) {
            notify(problems.map(p => `• ${p.message}`).join('\n'), 'Not finished yet');
            return;
          }
          if ([data.secondaryExecutor, data.backupExecutor].some(e => e.address.trim() && !e.name.trim())) {
            notify('One of the extra executors has an address but no name. Give them a name, or clear the address.');
            return;
          }
          onNext();
        }}
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
  roleOption: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    backgroundColor: C.surface,
  },
  roleOptionActive: {
    borderColor: C.primary,
    backgroundColor: '#EEF3FA',
  },
  roleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  roleTitleActive: {
    color: C.primary,
  },
  roleDetail: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 2,
    lineHeight: 18,
  },
  removeLink: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  removeLinkText: {
    color: C.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});
