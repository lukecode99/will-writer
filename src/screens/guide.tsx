import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './shared';

/**
 * The honest core of the service, in one place.
 *
 * These lists say what the app can and cannot be trusted with. They are shown on
 * the homepage (so a visitor knows before they start) and again on the
 * start/saved-wills screen — so they live here, as a single source of truth, and
 * can never drift apart between the two screens. A will that quietly fails is
 * worse than no will, so the limits are named plainly, not buried in a licence.
 */

export const SUITABLE = [
  'One person\'s will, under the law of England and Wales.',
  'Leaving everything, or shares of it, to people or charities you name.',
  'A handful of specific gifts — an item, a sum of money, a property.',
  'Appointing executors, and guardians for children under 18.',
  'Holding a child\'s share until they are 18.',
];

/** A line in the guide. `why` is for the cases where naming the situation is
 *  not enough on its own — where a reader would otherwise reasonably think
 *  "that's fine, I'll just write it in the will anyway". */
export interface GuideItem {
  text: string;
  why?: string;
}

export const NOT_SUITABLE: GuideItem[] = [
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
      'of why you did it — a solicitor would support you with this, where this app cannot.',
  },
  { text: 'You have children from an earlier relationship as well as a current partner, and want to provide for both.' },
  { text: 'You are separated but not divorced. Until the divorce is final your spouse is still your spouse.' },
  { text: 'Your estate is big enough that inheritance tax planning matters — this app does not do tax planning.' },
  { text: 'The person making the will is seriously ill, or there is any doubt they fully understand it.' },
];

export const WORTH_KNOWING = [
  'The will is not valid until it is signed in front of two witnesses, who both sign it too.',
  'A witness — or their husband, wife or civil partner — cannot inherit under the will they witness. The gift to them fails, and the rest of the will stands.',
  'Getting married or entering a civil partnership cancels an existing will, unless it was made in expectation of that particular marriage.',
  'Divorce does not cancel your will, but your former spouse is treated as having died before you.',
  'This app makes single wills. A couple need one each, filled in and signed separately.',
];

export function Bullets({
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

/** The full three-part guide, as shown inside the "right for you?" disclosure. */
export function SuitabilityLists() {
  return (
    <View>
      <Text style={styles.guideTitle}>This app is built for</Text>
      <Bullets items={SUITABLE} marker="✓" color={C.success} />

      <Text style={styles.guideTitle}>See a solicitor instead if</Text>
      <Bullets items={NOT_SUITABLE} marker="✗" color={C.danger} />

      <Text style={styles.guideTitle}>Worth knowing either way</Text>
      <Bullets items={WORTH_KNOWING} marker="•" color={C.textLight} />
    </View>
  );
}

const styles = StyleSheet.create({
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
});
