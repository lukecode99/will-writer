import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { WillData, Beneficiary, SubstitutionType, SpecificGift } from '../types';
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

/**
 * Raw enum values leak the codebase's naming onto the one screen that exists
 * to be read back in plain English — "civilPartnership" is not what anyone
 * selected. Unknown values fall through unchanged rather than to '' so that a
 * corrupt store is still visible here instead of reading as "not set".
 */
const MARITAL_LABELS: Record<string, string> = {
  single: 'Single',
  married: 'Married',
  civilPartnership: 'Civil partnership',
  divorced: 'Divorced',
  widowed: 'Widowed',
};

const BURIAL_LABELS: Record<string, string> = {
  burial: 'Burial',
  cremation: 'Cremation',
  noPreference: 'No preference',
};

/** A share as the user should see it echoed back, including when it is unusable. */
function shareLabel(raw: string): string {
  const value = parsePercentage(raw);
  if (value !== null) return formatPercentage(value);
  return raw.trim() ? `${raw.trim()} — not a valid share` : 'no share set';
}

// One line summarising where a gift goes if its recipient dies first, matching
// the three options on the Specific Gifts screen. Named alternatives take
// jointly, so they are listed rather than apportioned.
function giftSubstitutionSummary(g: SpecificGift): string {
  if (g.substitutionType === 'per-stirpes') {
    return `Passes to ${g.recipient.trim() || 'the recipient'}’s children (per stirpes)`;
  }
  if (g.substitutionType === 'named') {
    const names = g.substitutionRecipients.map(s => s.name.trim()).filter(Boolean);
    if (names.length === 0) return 'Passes to someone else (not yet named)';
    const joined = names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} (jointly)`;
    return `Passes to ${joined}`;
  }
  return 'Falls into residuary estate';
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

/**
 * The share's journey as a sequence of destinations, one per line.
 *
 * This used to be one sentence per beneficiary ("Sam — 100%", "If nobody: John",
 * "Predeceases: children") — three true statements that never joined up, on the
 * screen whose whole job is to show where the money goes. What the reader wants
 * is the order: Samantha, then the children, then John. So each entry is a step
 * in that order, rendered as an arrowed chain.
 *
 * The ultimate backstop is deliberately NOT a step here. It belongs to the
 * estate, not to any one share — it operates only when every chain on the
 * panel has failed — so it is rendered once, as the panel's final row, below
 * all of the chains. Putting it inside each chain said "John" as many times
 * as there were beneficiaries.
 */
function chainSteps(b: Beneficiary, data: WillData): string[] {
  const steps: string[] = [];
  const sub = b.substitution;
  switch (sub.type) {
    case 'own-children':
      steps.push('your children equally (a child of yours who has died is replaced by their own children)');
      break;
    case 'per-stirpes':
      steps.push(`${b.name.trim() || '(unnamed)'}'s own children equally (a child of theirs who has died is replaced by their own children)`);
      break;
    case 'named': {
      const named = sub.substitutes.filter(s => s.name.trim());
      // Shares shown, because this panel is read back to check the will says
      // what was meant, and between two named substitutes the split IS the
      // provision.
      if (named.length === 0) steps.push('the people you name (none added yet)');
      else if (named.length === 1) steps.push(named[0].name.trim());
      else steps.push(named.map(s => `${s.name.trim()} (${s.share.trim() || '?'}% of the share)`).join(' + '));
      if (named.length > 0 && sub.namedFallback === 'issue') {
        steps.push('a named person who has died is replaced by their own children');
      }
      break;
    }
    case 'pro-rata': {
      const others = proRataResult(data.beneficiaries, b.id);
      steps.push(others.length === 0
        ? 'the other beneficiaries (none yet)'
        : `the other beneficiaries, pro-rata: ${others.map(o => `${o.name} ${o.pct.toFixed(1)}%`).join(', ')}`);
      break;
    }
  }
  // The sideways step. Skipped for pro-rata, where it IS the first step.
  if (sub.type !== 'pro-rata' && data.beneficiaries.some(x => x.id !== b.id && x.name.trim())) {
    steps.push('the other surviving beneficiaries');
  }
  return steps;
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
    // Honest about the state of the feature BEFORE doing anything. The old
    // wording said "Sending to print service" and then generated the PDF, so
    // the user reasonably believed a paper will was on its way — for a
    // document whose whole value is the signed paper copy.
    notify(
      Platform.OS === 'web'
        ? 'The print & post service is not available yet. We will download your PDF now so you can print and sign it yourself.'
        : 'The print & post service is not available yet. We will open your PDF now — choose Print or Save to Files, then sign the paper copy.',
      'Not available yet',
    );
    await handleGenerate();
  }

  // A switch rather than a ternary chain, so that adding a fifth substitution
  // type is a compile error here instead of silently labelling itself
  // "Pro-rata among survivors" — which is exactly what the chain did to
  // 'own-children' the moment it was added, because it was typed `string` and
  // the final `:` swallows everything it does not recognise. The row below it
  // described the provision correctly at the same time, so this screen read
  // "Pro-rata among survivors → Your own children inherit equally": a review
  // screen contradicting itself about where the estate goes, on the one screen
  // whose whole job is to be read back before signing.
  const subTypeLabel = (type: SubstitutionType): string => {
    switch (type) {
      case 'per-stirpes': return "Beneficiary's children (per stirpes)";
      case 'named': return 'Named person';
      case 'pro-rata': return 'Pro-rata among survivors';
      case 'own-children': return 'Your own children';
    }
  };

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
        <Row label="Marital status" value={MARITAL_LABELS[data.maritalStatus] ?? data.maritalStatus} />
      </Section>

      <Section title="Partner & Children" stepKey="family" onEdit={onEdit}>
        {data.partnerName
          ? <Row label="Partner" value={data.partnerName} />
          : <Text style={styles.empty}>No partner recorded</Text>
        }
        {data.expectingMarriage && data.intendedSpouseName.trim() ? (
          <Row label="Expecting to marry" value={data.intendedSpouseName.trim()} />
        ) : null}
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
                value={giftSubstitutionSummary(g)}
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
        {/* The backstop reads in the order it operates: after every chain in
            the panel below has failed. So when the panel renders, the panel
            carries it as its final row; this card only shows it when there are
            no beneficiaries and therefore no panel to put it under. */}
        {data.ultimateBackstop
          ? (data.beneficiaries.length === 0
            ? <Row label="If nobody survives" value={data.ultimateBackstop} />
            : null)
          : <Text style={styles.empty}>No ultimate backstop set (intestacy applies)</Text>
        }
      </Section>

      {data.beneficiaries.length > 0 && (
        <View style={styles.whatIfPanel}>
          <Text style={styles.whatIfTitle}>If a beneficiary dies before you, their share passes down this chain</Text>
          {data.beneficiaries.map(b => (
            <View key={b.id} style={styles.whatIfRow}>
              <Text style={styles.whatIfName}>
                {b.name || '(unnamed)'} ({shareLabel(b.percentage)}) — {subTypeLabel(b.substitution.type)}
              </Text>
              {chainSteps(b, data).map((step, i) => (
                <Text key={i} style={styles.whatIfSub}>{'→'}  {step}</Text>
              ))}
            </View>
          ))}
          {data.ultimateBackstop ? (
            <View style={[styles.whatIfRow, { borderTopWidth: 1, borderTopColor: C.border, marginTop: 8, paddingTop: 8 }]}>
              <Text style={styles.whatIfName}>If nobody above survives</Text>
              <Text style={styles.whatIfSub}>{'→'}  {data.ultimateBackstop}</Text>
            </View>
          ) : null}
        </View>
      )}

      <Section title="Funeral Wishes" stepKey="funeral" onEdit={onEdit}>
        {data.burialPreference
          ? <Row label="Preference" value={BURIAL_LABELS[data.burialPreference] ?? data.burialPreference} />
          : null}
        {data.funeralWishes
          ? <Row label="Wishes" value={data.funeralWishes} />
          : <Text style={styles.empty}>No funeral wishes recorded</Text>}
      </Section>

      {/* The signing rules used to live only in Home's collapsed guide, which
          nobody re-opens on the way out. This is the last screen before a
          document exists, so the two rules that can silently destroy it —
          botched witnessing and a later marriage — are stated here, where the
          person about to print is actually looking. */}
      <View style={styles.signingPanel}>
        <Text style={styles.signingTitle}>Before your will is legally valid</Text>
        <Text style={styles.signingText}>
          • Sign it in front of two adult witnesses, both present at the same time, who then sign
          while you watch. Unwitnessed, it is just paper.{'\n'}
          • A witness (or a witness's spouse or civil partner) who is left anything in this will
          loses that gift — the will survives, their inheritance does not. Choose witnesses who
          inherit nothing.{'\n'}
          • Marrying or entering a civil partnership after signing cancels this will automatically,
          unless it names the person you expect to marry. If that happens, make a new will.
        </Text>
      </View>

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
  signingPanel: {
    backgroundColor: '#EEF3FA',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#C7D5F0',
  },
  signingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E3A8A',
    marginBottom: 6,
  },
  signingText: {
    fontSize: 13,
    color: '#1E3A8A',
    lineHeight: 20,
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
