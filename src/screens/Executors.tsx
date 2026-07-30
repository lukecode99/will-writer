import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { WillData, Executor } from '../types';
import { blockingProblems } from '../validation';
import { shared } from './shared';
import { notify } from '../platform';

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
        <ExecForm
          label="Secondary Executor (optional)"
          hint="Acts jointly or as a substitute if the primary is unable."
          value={data.secondaryExecutor}
          onChange={v => onChange({ secondaryExecutor: v })}
        />
      ) : (
        <TouchableOpacity style={shared.addBtn} onPress={() => setShowSecondary(true)}>
          <Text style={shared.addBtnText}>+ Add a second executor</Text>
        </TouchableOpacity>
      )}

      {showBackup ? (
        <ExecForm
          label="Backup Executor (optional)"
          hint="Appointed only if neither primary nor secondary can act."
          value={data.backupExecutor}
          onChange={v => onChange({ backupExecutor: v })}
        />
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
