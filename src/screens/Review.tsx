import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { WillData, Beneficiary } from '../types';
import { hasMinorChildren } from '../family';
import { C, shared } from './shared';
import { notify, deliverPdf } from '../platform';
// Imported statically on purpose. This was briefly a dynamic import() to keep a
// pdf-lib load failure off the startup path, but `expo export --platform web`
// splits the chunk out without emitting a loader for it, so the require failed
// with "Requiring unknown module" and the PDF could never be generated. The
// underlying tslib problem is fixed properly by the resolver alias in
// metro.config.js, so the lazy load bought nothing.
import { generateWillPdf, WillIncompleteError } from '../pdfGen';
import {
  StepKey,
  WillProblem,
  blockingProblems,
  warnings,
  parsePercentage,
  formatPercentage,
} from '../validation';

interface Props {
  data: WillData;
  onEdit: (step: StepKey) => void;
  onBack: () => void;
  onRestart: () => void;
}

/** A share as the user should see it echoed back, including when it is unusable. */
function shareLabel(raw: string): string {
  const value = parsePercentage(raw);
  if (value !== null) return formatPercentage(value);
  return raw.trim() ? `${raw.trim()} — not a valid share` : 'no share set';
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
  stepKey,
  children,
  onEdit,
}: {
  title: string;
  stepKey: StepKey;
  children: React.ReactNode;
  onEdit: (step: StepKey) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <TouchableOpacity onPress={() => onEdit(stepKey)}>
          <Text style={styles.editLink}>Edit</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

/** A list of problems, each tappable through to the step that fixes it. */
function ProblemPanel({
  title,
  intro,
  problems,
  tone,
  onEdit,
}: {
  title: string;
  intro: string;
  problems: WillProblem[];
  tone: 'blocking' | 'warning';
  onEdit: (step: StepKey) => void;
}) {
  if (problems.length === 0) return null;
  const panel = tone === 'blocking' ? styles.blockingPanel : styles.warningPanel;
  const heading = tone === 'blocking' ? styles.blockingTitle : styles.warningTitle;
  const body = tone === 'blocking' ? styles.blockingText : styles.warningText;
  return (
    <View style={panel}>
      <Text style={heading}>{title}</Text>
      <Text style={[body, { marginBottom: 8 }]}>{intro}</Text>
      {problems.map((problem, i) => (
        <TouchableOpacity
          key={`${problem.step}-${i}`}
          style={styles.problemRow}
          onPress={() => onEdit(problem.step)}
        >
          <Text style={body}>• {problem.message}</Text>
          <Text style={styles.problemFix}>Fix this →</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function proRataResult(
  beneficiaries: Beneficiary[],
  deceasedId: string,
): Array<{ name: string; pct: number }> {
  const survivors = beneficiaries.filter(
    b => b.id !== deceasedId && (parsePercentage(b.percentage) ?? 0) > 0,
  );
  const total = survivors.reduce((s, b) => s + (parsePercentage(b.percentage) ?? 0), 0);
  if (total === 0 || survivors.length === 0) return [];
  return survivors.map(b => ({
    name: b.name || '(unnamed)',
    pct: ((parsePercentage(b.percentage) ?? 0) / total) * 100,
  }));
}

function whatIfOutcome(b: Beneficiary, allBens: Beneficiary[]): string {
  const sub = b.substitution;
  switch (sub.type) {
    case 'per-stirpes':
      return `${b.name}'s children inherit equally (per stirpes)`;
    case 'named':
      return sub.namedPerson
        ? `Passes to ${sub.namedPerson}`
        : 'Named recipient (not yet specified)';
    case 'pro-rata': {
      const others = proRataResult(allBens, b.id);
      if (others.length === 0) return 'No other beneficiaries';
      return others.map(o => `${o.name}: ${o.pct.toFixed(1)}%`).join(', ');
    }
  }
}

export default function Review({ data, onEdit, onBack, onRestart }: Props) {
  const [generating, setGenerating] = useState(false);

  // Recomputed on every render rather than held in state: the review screen is
  // the one place that must never be describing an older version of the answers
  // than the one on screen.
  const blocking = blockingProblems(data);
  const advisory = warnings(data);
  const canGenerate = blocking.length === 0;
  const showGuardians = hasMinorChildren(data);

  async function handleGenerate() {
    // The button is disabled while anything is blocking, but the check is
    // repeated here because a disabled button is a presentation detail and this
    // is the last point before a document exists.
    if (blocking.length > 0) {
      notify('There are still some things to fix before your will can be created. They are listed at the top of this page.');
      return;
    }
    setGenerating(true);
    try {
      const bytes = await generateWillPdf(data);
      await deliverPdf(bytes, `Will_${data.fullName.replace(/\s+/g, '_') || 'Draft'}.pdf`);
    } catch (err) {
      console.error('PDF generation failed', err);
      if (err instanceof WillIncompleteError) {
        notify(err.problems.map(p => `• ${p.message}`).join('\n'), 'Not ready yet');
      } else {
        notify('Could not generate your PDF. Please try again.');
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handlePrintService() {
    if (blocking.length > 0) {
      notify('There are still some things to fix before your will can be printed. They are listed at the top of this page.');
      return;
    }
    notify(
      Platform.OS === 'web'
        ? 'Sending to print service — downloading your PDF now.\n\n(Print dispatch will be wired in a future update.)'
        : 'Sending to print service — opening your PDF now. Choose Print or Save to Files.\n\n(Print dispatch will be wired in a future update.)',
    );
    await handleGenerate();
  }

  const subTypeLabel = (type: string) =>
    type === 'per-stirpes' ? 'Children (per stirpes)' : type === 'named' ? 'Named person' : 'Pro-rata among survivors';

  return (
    <ScrollView contentContainerStyle={shared.scrollContent}>
      <Text style={shared.heading}>Review Your Will</Text>
      <Text style={shared.sub}>Check everything below before generating your PDF. Tap Edit to change any section.</Text>

      <ProblemPanel
        tone="blocking"
        title="Fix these before you can create your will"
        intro="A will with any of these missing would not do what you want it to do — and signing it would still cancel any earlier will you have made."
        problems={blocking}
        onEdit={onEdit}
      />

      <ProblemPanel
        tone="warning"
        title="Worth a second look"
        intro="None of these stop you creating your will. Check they are what you meant."
        problems={advisory}
        onEdit={onEdit}
      />

      <Section title="About You" stepKey="about" onEdit={onEdit}>
        <Row label="Name" value={data.fullName} />
        <Row label="Address" value={data.address} />
        <Row label="Date of birth" value={data.dob} />
        <Row label="Marital status" value={data.maritalStatus} />
      </Section>

      <Section title="Partner & Children" stepKey="family" onEdit={onEdit}>
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

      <Section title="Executors" stepKey="executors" onEdit={onEdit}>
        <Row label="Primary" value={data.primaryExecutor.name} />
        {data.secondaryExecutor.name ? <Row label="Secondary" value={data.secondaryExecutor.name} /> : null}
        {data.backupExecutor.name ? <Row label="Backup" value={data.backupExecutor.name} /> : null}
      </Section>

      {/* Shown whenever guardians exist, even if the guardians step is hidden
          because no child is under 18 any more. Those guardians are still in the
          document, so hiding the section made them impossible to remove. */}
      {(showGuardians || data.guardians.length > 0) ? (
        <Section title="Guardians" stepKey="guardians" onEdit={onEdit}>
          {/* Labelled by tier, not by position. "Guardian 1 / Guardian 2" read
              as first-choice-then-backup while the will appointed both jointly,
              which is the mismatch this section now has to make visible. */}
          {data.guardians.length === 0
            ? <Text style={styles.empty}>No guardians appointed</Text>
            : data.guardians
              .filter(g => g.role === 'primary')
              .map((g, i) => (
                <Row key={g.id} label={`First choice ${i + 1}`} value={g.name} />
              ))
              .concat(
                data.guardians
                  .filter(g => g.role === 'substitute')
                  .map((g, i) => (
                    <Row key={g.id} label={`Substitute ${i + 1}`} value={g.name} />
                  )),
              )
          }
        </Section>
      ) : null}

      <Section title="Specific Gifts" stepKey="gifts" onEdit={onEdit}>
        {data.specificGifts.length === 0
          ? <Text style={styles.empty}>No specific gifts</Text>
          : data.specificGifts.map((g, i) => (
            <View key={g.id}>
              <Row label={`Gift ${i + 1}`} value={`${g.description} → ${g.recipient}${g.isCharity ? ' (charity)' : ''}`} />
              {!g.isCharity && (
                <Row
                  label="Inheritance tax"
                  value={g.taxBurden === 'freeOfTax'
                    ? 'Paid by your estate (reduces residuary shares)'
                    : 'Paid by the recipient'}
                />
              )}
              <Row
                label="If recipient dies"
                value={g.substitutionType === 'named'
                  ? `Passes to ${g.substitutionRecipient || '(not yet named)'}`
                  : 'Falls into residuary estate'}
              />
            </View>
          ))
        }
      </Section>

      <Section title="Residuary Estate" stepKey="residuary" onEdit={onEdit}>
        {data.beneficiaries.length === 0
          ? <Text style={styles.empty}>No beneficiaries added</Text>
          : data.beneficiaries.map(b => (
            <Row
              key={b.id}
              label={b.name || '(unnamed)'}
              value={`${shareLabel(b.percentage)}${b.relationship ? ` (${b.relationship})` : ''}${b.isMinor ? ' · minor' : ''}`}
            />
          ))
        }
        {data.ultimateBackstop
          ? <Row label="If nobody survives" value={data.ultimateBackstop} />
          : <Text style={styles.empty}>No ultimate backstop set (intestacy applies)</Text>
        }
      </Section>

      {data.beneficiaries.length > 0 && (
        <View style={styles.whatIfPanel}>
          <Text style={styles.whatIfTitle}>What happens if a beneficiary predeceases you?</Text>
          {data.beneficiaries.map(b => (
            <View key={b.id} style={styles.whatIfRow}>
              <Text style={styles.whatIfName}>
                {b.name || '(unnamed)'} ({shareLabel(b.percentage)})
              </Text>
              <Text style={styles.whatIfSub}>
                {subTypeLabel(b.substitution.type)} → {whatIfOutcome(b, data.beneficiaries)}
              </Text>
            </View>
          ))}
          {data.ultimateBackstop ? (
            <View style={[styles.whatIfRow, { borderTopWidth: 1, borderTopColor: C.border, marginTop: 8, paddingTop: 8 }]}>
              <Text style={styles.whatIfName}>If no one survives</Text>
              <Text style={styles.whatIfSub}>{data.ultimateBackstop}</Text>
            </View>
          ) : null}
        </View>
      )}

      <Section title="Funeral Wishes" stepKey="funeral" onEdit={onEdit}>
        {data.burialPreference ? <Row label="Preference" value={data.burialPreference} /> : null}
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
        style={[shared.primaryBtn, (generating || !canGenerate) ? styles.btnDisabled : null]}
        onPress={handleGenerate}
        disabled={generating || !canGenerate}
      >
        {generating
          ? <ActivityIndicator color="#fff" />
          : <Text style={shared.primaryBtnText}>⬇️  Download Will PDF</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity
        style={[shared.secondaryBtn, { marginTop: 10 }, (generating || !canGenerate) ? styles.btnDisabled : null]}
        onPress={handlePrintService}
        disabled={generating || !canGenerate}
      >
        <Text style={shared.secondaryBtnText}>📬  Send to print service</Text>
      </TouchableOpacity>

      {!canGenerate ? (
        <Text style={styles.blockedNote}>
          {blocking.length === 1
            ? 'One thing above still needs fixing before your will can be created.'
            : `${blocking.length} things above still need fixing before your will can be created.`}
        </Text>
      ) : null}

      <TouchableOpacity style={[shared.secondaryBtn, { marginTop: 8 }]} onPress={onBack}>
        <Text style={shared.secondaryBtnText}>Back</Text>
      </TouchableOpacity>

      {/* This used to be "Start over", which wiped the answers. Now that the
          app holds more than one will, the same tap means "leave this one and
          go back to the list" — and deleting a will is a deliberate act on the
          home screen, behind a confirmation, rather than a link next to Back. */}
      <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={onRestart}>
        <Text style={{ color: C.textLight, fontSize: 13 }}>Back to my wills</Text>
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
    width: 120,
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
  whatIfPanel: {
    backgroundColor: '#F0F4FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#C7D5F0',
  },
  whatIfTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E3A8A',
    marginBottom: 10,
  },
  whatIfRow: {
    marginBottom: 8,
  },
  whatIfName: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
  },
  whatIfSub: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
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
    opacity: 0.45,
  },
  blockingPanel: {
    backgroundColor: '#FDECEA',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0B3AC',
  },
  blockingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8A1C10',
    marginBottom: 4,
  },
  blockingText: {
    fontSize: 13,
    color: '#8A1C10',
    lineHeight: 18,
  },
  warningPanel: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8D48B',
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7A5A00',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 13,
    color: '#7A5A00',
    lineHeight: 18,
  },
  problemRow: {
    paddingVertical: 6,
  },
  problemFix: {
    fontSize: 12,
    fontWeight: '600',
    color: C.primary,
    marginTop: 2,
  },
  blockedNote: {
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 10,
  },
});
