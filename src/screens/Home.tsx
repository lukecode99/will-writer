import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WillSummary, PrintedWill, loadWillData } from '../storage';
import { blockingProblems } from '../validation';
import { confirmDestructive } from '../platform';
import { C, shared, CONTENT_MAX_WIDTH } from './shared';
import { SuitabilityLists } from './guide';

interface Props {
  wills: WillSummary[];
  printed: PrintedWill[];
  onCreate: (isForSomeoneElse: boolean) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function statusOf(id: string): { label: string; done: boolean } {
  const data = loadWillData(id);
  if (!data.fullName.trim()) return { label: 'Not started', done: false };
  const problems = blockingProblems(data);
  if (problems.length === 0) return { label: 'Ready to print and sign', done: true };
  const n = problems.length;
  return { label: `${n} thing${n === 1 ? '' : 's'} still to finish`, done: false };
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

/** A date with its weekday, for a delivery estimate people read at a glance. */
function formatDeliveryDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return '';
  }
}

/**
 * Add N working days to a timestamp, skipping Saturdays and Sundays.
 *
 * Bank holidays are not subtracted out — they would need a maintained list, and
 * getting it wrong is worse than a slightly optimistic date. The estimate is
 * always phrased as "usually by", never a promise, precisely so Royal Mail (and
 * the odd bank holiday) have room to move without the app having lied.
 */
function addWorkingDays(ms: number, days: number): number {
  const d = new Date(ms);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.getTime();
}

export default function Home({ wills, printed, onCreate, onOpen, onDelete }: Props) {
  const insets = useSafeAreaInsets();
  const [showGuide, setShowGuide] = useState(false);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <View style={styles.headerInner}>
          <Text style={styles.appTitle}>SortedWill</Text>
          <Text style={styles.appSub}>Wills for England and Wales</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[shared.scrollContent, { paddingBottom: insets.bottom + 48 }]}>
        <View style={styles.column}>
          <Text style={shared.heading}>Start a new will</Text>
          <Text style={shared.sub}>
            You can write your own, or fill one in on behalf of someone else. Either way, the
            person the will belongs to is the one who has to sign it.
          </Text>

          <TouchableOpacity style={shared.primaryBtn} onPress={() => onCreate(false)}>
            <Text style={shared.primaryBtnText}>A will for me</Text>
          </TouchableOpacity>

          <TouchableOpacity style={shared.secondaryBtn} onPress={() => onCreate(true)}>
            <Text style={shared.secondaryBtnText}>A will for someone else</Text>
          </TouchableOpacity>

          {wills.length > 0 ? (
            <>
              <Text style={shared.sectionTitle}>Your saved wills</Text>
              <Text style={shared.hint}>
                Saved on this device only. Nothing is uploaded anywhere, which also means
                nobody can recover a will you delete.
              </Text>

              {wills.map(w => {
                const status = statusOf(w.id);
                return (
                  <View key={w.id} style={shared.card}>
                    <TouchableOpacity
                      onPress={() => onOpen(w.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open the will for ${w.title || 'an unnamed person'}`}
                    >
                      <Text style={styles.willName}>{w.title || 'Untitled will'}</Text>
                      <Text style={styles.willMeta}>
                        {w.isForSomeoneElse ? 'For someone else' : 'For me'}
                        {w.updatedAt ? ` · edited ${formatDate(w.updatedAt)}` : ''}
                      </Text>
                      <Text style={[styles.willStatus, status.done ? styles.willStatusDone : null]}>
                        {status.label}
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.cardActions}>
                      <TouchableOpacity style={styles.openBtn} onPress={() => onOpen(w.id)}>
                        <Text style={styles.openBtnText}>Open</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={shared.dangerBtn}
                        onPress={() =>
                          confirmDestructive(
                            `Delete the will for ${w.title || 'this unnamed person'}? This is the only copy, and it cannot be undone.`,
                            'Delete',
                            () => onDelete(w.id),
                          )
                        }
                      >
                        <Text style={shared.dangerBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}

          {printed.length > 0 ? (
            <>
              <Text style={shared.sectionTitle}>Your printed wills</Text>
              <Text style={shared.hint}>
                Wills you've had printed and posted. Sign yours in front of two witnesses as soon
                as it arrives — it isn't legally valid until you do.
              </Text>

              {printed.map(p => {
                const eta = addWorkingDays(p.printedAt, 4);
                return (
                  <View key={p.letterId} style={[shared.card, styles.printedCard]}>
                    <Text style={styles.willName}>{p.title || 'Your will'}</Text>
                    <View style={styles.printedRow}>
                      <Text style={styles.printedLabel}>Printed</Text>
                      <Text style={styles.printedValue}>{formatDate(p.printedAt)}</Text>
                    </View>
                    <View style={styles.printedRow}>
                      <Text style={styles.printedLabel}>Expected delivery</Text>
                      <Text style={styles.printedValue}>usually by {formatDeliveryDate(eta)}</Text>
                    </View>
                    <Text style={styles.printedNote}>
                      Sent by Royal Mail first class — most arrive within 2–4 working days. We keep
                      no copy of your will, so this is a record of the order, not the document.
                    </Text>
                  </View>
                );
              })}
            </>
          ) : null}

          <Text style={shared.sectionTitle}>Is this app right for you?</Text>
          <Text style={shared.hint}>
            Worth two minutes before you start. Some situations need a solicitor, and this
            says which.
          </Text>

          <TouchableOpacity
            style={shared.addBtn}
            onPress={() => setShowGuide(v => !v)}
            accessibilityRole="button"
          >
            <Text style={shared.addBtnText}>
              {showGuide ? 'Hide' : 'What this app can and cannot do'}
            </Text>
          </TouchableOpacity>

          {showGuide ? <SuitabilityLists /> : null}

          <Text style={styles.disclaimer}>
            SortedWill produces a document from the answers you give it. It does not read
            your circumstances and it is not legal advice. If anything on this page describes
            you, the cost of an hour with a solicitor is small next to the cost of getting
            this wrong.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    backgroundColor: C.primary,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerInner: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  appSub: {
    color: '#C7D6EA',
    fontSize: 13,
    marginTop: 2,
  },
  column: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  willName: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  willMeta: {
    fontSize: 12,
    color: C.textLight,
    marginTop: 2,
  },
  willStatus: {
    fontSize: 13,
    color: C.textLight,
    marginTop: 6,
  },
  willStatusDone: {
    color: C.success,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  printedCard: {
    borderLeftWidth: 3,
    borderLeftColor: C.success,
  },
  printedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 8,
    gap: 12,
  },
  printedLabel: {
    fontSize: 13,
    color: C.textLight,
  },
  printedValue: {
    fontSize: 13,
    fontWeight: '600',
    color: C.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  printedNote: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 17,
    marginTop: 12,
  },
  openBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  openBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
    marginTop: 24,
  },
});
