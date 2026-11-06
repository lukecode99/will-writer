import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WillSummary, loadWillData } from '../storage';
import { blockingProblems } from '../validation';
import { confirmDestructive } from '../platform';
import { C, shared, CONTENT_MAX_WIDTH } from './shared';
import { SuitabilityLists } from './guide';

interface Props {
  wills: WillSummary[];
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

export default function Home({ wills, onCreate, onOpen, onDelete }: Props) {
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
