import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WillSummary, loadWillData } from '../storage';
import { blockingProblems } from '../validation';
import { confirmDestructive } from '../platform';
import { C, shared, CONTENT_MAX_WIDTH } from './shared';

interface Props {
  wills: WillSummary[];
  onCreate: (isForSomeoneElse: boolean) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * What this app can and cannot be trusted with.
 *
 * A will that quietly fails is worse than no will, because nobody finds out
 * until the person who could have fixed it is dead. Every line below is a
 * situation where the document this app produces would be valid but wrong for
 * the user's circumstances, so the honest thing is to say so before they spend
 * half an hour filling it in — not in terms buried in a licence.
 */
const SUITABLE = [
  'One person\'s will, under the law of England and Wales.',
  'Leaving everything, or shares of it, to people or charities you name.',
  'A handful of specific gifts — an item, a sum of money, a property.',
  'Appointing executors, and guardians for children under 18.',
  'Holding a child\'s share until they are 18.',
];

/** A line in the guide. `why` is for the cases where naming the situation is
 *  not enough on its own — where a reader would otherwise reasonably think
 *  "that's fine, I'll just write it in the will anyway". */
interface GuideItem {
  text: string;
  why?: string;
}

const NOT_SUITABLE: GuideItem[] = [
  { text: 'You live in Scotland or Northern Ireland, or own property outside England and Wales — different law applies, and this will may not do what you expect there.' },
  { text: 'You own a business, a farm, or agricultural land.' },
  { text: 'You want a trust that lasts — a life interest for a partner, or provision for a disabled beneficiary.' },
  {
    text: 'You want to leave out a spouse, civil partner, child, or anyone who depends on you financially.',
    // The one item people argue with, because writing someone out feels like
    // something a will obviously can do. It can. It just does not settle it —
    // and what settles it is evidence this app has no way of producing.
    why:
      'Leaving someone out of the will does not remove them. A husband, wife or civil partner, ' +
      'a child of any age, and anyone you were supporting financially can all ask a court to ' +
      'override what the will says and award them a share — and courts do. A spouse has the ' +
      'strongest claim: they do not have to show they need the money, only that what you left ' +
      'them was less than reasonable.\n\n' +
      'What defends that kind of will is not its wording. It is evidence, recorded at the time, ' +
      'of why you did it — a solicitor\'s notes of what you told them, and a signed letter kept ' +
      'with the will. This app cannot produce any of that. It prints what you type. If the will ' +
      'is challenged there is nothing behind it to explain your reasons, and the people you were ' +
      'trying to provide for are the ones left arguing it out in court, paying for it out of the ' +
      'estate, after you are gone.',
  },
  { text: 'You have children from an earlier relationship as well as a current partner, and want to provide for both.' },
  { text: 'You are separated but not divorced. Until the divorce is final your spouse is still your spouse.' },
  { text: 'Your estate is big enough that inheritance tax planning matters — this app does not do tax planning.' },
  { text: 'The person making the will is seriously ill, or there is any doubt they fully understand it.' },
];

const WORTH_KNOWING = [
  'The will is not valid until it is signed in front of two witnesses, who both sign it too.',
  'A witness — or their husband, wife or civil partner — cannot inherit under the will they witness. The gift to them fails, and the rest of the will stands.',
  'Getting married or entering a civil partnership cancels an existing will, unless it was made in expectation of that particular marriage.',
  'Divorce does not cancel your will, but your former spouse is treated as having died before you.',
  'This app makes single wills. A couple need one each, filled in and signed separately.',
];

function Bullets({
  items,
  marker,
  color,
}: {
  items: (string | GuideItem)[];
  marker: string;
  color: string;
}) {
  return (
    <View style={styles.bullets}>
      {items.map(item => {
        const { text, why } = typeof item === 'string' ? { text: item, why: undefined } : item;
        return (
          <View key={text} style={styles.bulletRow}>
            <Text style={[styles.marker, { color }]}>{marker}</Text>
            {/* The explanation sits inside the bullet rather than beneath the
                list, so it stays attached to the line it explains however the
                text wraps. */}
            <View style={styles.bulletBody}>
              <Text style={styles.bulletText}>{text}</Text>
              {why ? <Text style={styles.bulletWhy}>{why}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
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
          <Text style={styles.appTitle}>Will Writer</Text>
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

          {showGuide ? (
            <View>
              <Text style={styles.guideTitle}>This app is built for</Text>
              <Bullets items={SUITABLE} marker="✓" color={C.success} />

              <Text style={styles.guideTitle}>See a solicitor instead if</Text>
              <Bullets items={NOT_SUITABLE} marker="✗" color={C.danger} />

              <Text style={styles.guideTitle}>Worth knowing either way</Text>
              <Bullets items={WORTH_KNOWING} marker="•" color={C.textLight} />
            </View>
          ) : null}

          <Text style={styles.disclaimer}>
            Will Writer produces a document from the answers you give it. It does not read
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
  guideTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.text,
    marginTop: 16,
    marginBottom: 4,
  },
  bullets: {
    marginTop: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  marker: {
    width: 18,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  bulletBody: {
    flex: 1,
  },
  bulletText: {
    fontSize: 13,
    color: C.text,
    lineHeight: 19,
  },
  // Set apart from the bullet it belongs to: a rule down the left edge, so a
  // long explanation reads as an aside rather than as three more bullets.
  bulletWhy: {
    fontSize: 12.5,
    color: C.textLight,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 4,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: C.border,
  },
  disclaimer: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
    marginTop: 24,
  },
});
