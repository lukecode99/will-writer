import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { WillData } from '../types';
import { C, shared } from './shared';

interface Props {
  data: WillData;
  onEdit: (step: number) => void;
  onBack: () => void;
  onRestart: () => void;
  hasGuardianStep: boolean;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '—'}</Text>
    </View>
  );
}

function Section({
  title,
  step,
  children,
  onEdit,
}: {
  title: string;
  step: number;
  children: React.ReactNode;
  onEdit: (step: number) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <TouchableOpacity onPress={() => onEdit(step)}>
          <Text style={styles.editLink}>Edit</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

export default function Review({ data, onEdit, onBack, onRestart, hasGuardianStep }: Props) {
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const { generateWillPdf } = await import('../pdfGen');
      const bytes = await generateWillPdf(data);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Will_${data.fullName.replace(/\s+/g, '_') || 'Draft'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('PDF generation failed', err);
      alert('Could not generate PDF. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function handlePrintService() {
    // v1-stub: same as download for now
    alert('Sending to print service — downloading your PDF now.\n\n(Print dispatch will be wired in a future update.)');
    await handleGenerate();
  }

  const statusLine = (label: string, hasValue: boolean) => (
    hasValue ? `✓ ${label}` : `— ${label} (not set)`
  );

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Review Your Will</Text>
      <Text style={shared.sub}>Check everything below before generating your PDF. Tap Edit to change any section.</Text>

      <Section title="About You" step={0} onEdit={onEdit}>
        <Row label="Name" value={data.fullName} />
        <Row label="Address" value={data.address} />
        <Row label="Date of birth" value={data.dob} />
        <Row label="Marital status" value={data.maritalStatus} />
      </Section>

      <Section title="Partner & Children" step={1} onEdit={onEdit}>
        {data.partnerName
          ? <Row label="Partner" value={data.partnerName} />
          : <Text style={styles.empty}>No partner recorded</Text>
        }
        {data.children.length === 0
          ? <Text style={styles.empty}>No children recorded</Text>
          : data.children.map((c, i) => (
            <Row key={c.id} label={`Child ${i + 1}`} value={`${c.name}${c.dob ? ` (DOB: ${c.dob})` : ''}`} />
          ))
        }
      </Section>

      <Section title="Executors" step={2} onEdit={onEdit}>
        <Row label="Primary" value={data.primaryExecutor.name} />
        {data.secondaryExecutor.name
          ? <Row label="Secondary" value={data.secondaryExecutor.name} />
          : null}
        {data.backupExecutor.name
          ? <Row label="Backup" value={data.backupExecutor.name} />
          : null}
      </Section>

      {hasGuardianStep ? (
        <Section title="Guardians" step={3} onEdit={onEdit}>
          {data.guardians.length === 0
            ? <Text style={styles.empty}>No guardians appointed</Text>
            : data.guardians.map((g, i) => (
              <Row key={g.id} label={`Guardian ${i + 1}`} value={g.name} />
            ))
          }
        </Section>
      ) : null}

      <Section title="Specific Gifts" step={hasGuardianStep ? 4 : 3} onEdit={onEdit}>
        {data.specificGifts.length === 0
          ? <Text style={styles.empty}>No specific gifts</Text>
          : data.specificGifts.map((g, i) => (
            <Row key={g.id} label={`Gift ${i + 1}`} value={`${g.description} → ${g.recipient}${g.isCharity ? ' (charity)' : ''}`} />
          ))
        }
      </Section>

      <Section title="Residuary Estate" step={hasGuardianStep ? 5 : 4} onEdit={onEdit}>
        {data.beneficiaries.length === 0
          ? <Text style={styles.empty}>No beneficiaries added</Text>
          : data.beneficiaries.map((b, i) => (
            <Row key={b.id} label={b.name} value={`${b.percentage}%${b.relationship ? ` (${b.relationship})` : ''}`} />
          ))
        }
        {data.residuaryBackup
          ? <Row label="Backup" value={data.residuaryBackup} />
          : null}
      </Section>

      <Section title="Funeral Wishes" step={hasGuardianStep ? 6 : 5} onEdit={onEdit}>
        {data.burialPreference
          ? <Row label="Preference" value={data.burialPreference} />
          : null}
        {data.funeralWishes
          ? <Row label="Wishes" value={data.funeralWishes} />
          : <Text style={styles.empty}>No funeral wishes recorded</Text>}
      </Section>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          ⚠️  This is a template document, not legal advice. For complex estates, consult a solicitor.
        </Text>
      </View>

      <TouchableOpacity
        style={[shared.primaryBtn, generating ? styles.btnDisabled : null]}
        onPress={handleGenerate}
        disabled={generating}
      >
        {generating
          ? <ActivityIndicator color="#fff" />
          : <Text style={shared.primaryBtnText}>⬇️  Download Will PDF</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity
        style={[shared.secondaryBtn, { marginTop: 10 }]}
        onPress={handlePrintService}
        disabled={generating}
      >
        <Text style={shared.secondaryBtnText}>📬  Send to print service</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[shared.secondaryBtn, { marginTop: 8 }]} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>

      <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={onRestart}>
        <Text style={{ color: C.textLight, fontSize: 13 }}>Start over</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
  },
  editLink: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 4,
    gap: 8,
  },
  rowLabel: {
    fontSize: 13,
    color: C.textLight,
    width: 100,
    flexShrink: 0,
  },
  rowValue: {
    fontSize: 13,
    color: C.text,
    flex: 1,
    flexWrap: 'wrap',
  },
  empty: {
    fontSize: 13,
    color: C.textLight,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  disclaimer: {
    backgroundColor: '#FFF3CD',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#856404',
    lineHeight: 18,
  },
  btnDisabled: {
    opacity: 0.7,
  },
});
