import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, shared, CONTENT_MAX_WIDTH } from './shared';
import { Bullets, NOT_SUITABLE } from './guide';
import AppHeader from '../components/AppHeader';
import { Button } from '../ui';

interface Props {
  /** Enter the app proper — the start / saved-wills screen. */
  onStart: () => void;
  /** Open the account screen from the standing top bar. */
  onAccount: () => void;
}

/**
 * The homepage.
 *
 * Someone arriving at sortedwill.co.uk for the first time used to land straight
 * on the "Start a new will / your saved wills" screen, with no word on what the
 * service is, what it costs, or why it can be trusted with something this
 * serious. This screen is that missing word — it explains the service and gives
 * one clear way in. It is shown only to a visitor with no saved will; a
 * returning user with a draft already on the device goes straight to their
 * wills (see App.tsx), because re-selling the service to someone mid-will is
 * noise.
 *
 * The copy keeps the app's voice: plain, and honest about the limits. The two
 * things that actually make a DIY will fail — the signing formalities and the
 * ban on a witness inheriting — are named here rather than buried, because the
 * pitch is precisely that the app watches for them.
 */

/** A step in "How it works". */
const STEPS: { title: string; body: string }[] = [
  {
    title: 'Answer a few plain questions',
    body: 'About you, your family, who you want to look after your estate, and who should inherit. No legal jargon — just your circumstances.',
  },
  {
    title: 'We draft the will',
    body: 'A complete will written to the law of England and Wales, checked as you go for the mistakes that quietly make a will fail.',
  },
  {
    title: 'Print it and sign it',
    body: 'Download the PDF to print at home, or have us print and post it to you — then sign it in front of two witnesses to make it legally valid.',
  },
];

/** Why trust this with something this serious. Benefit-led and plain. */
const WHY: string[] = [
  'Simple and straightforward — a few plain questions, no legal jargon.',
  'No printer? No problem — we can print your will and post it to you.',
  'We flag the common pitfalls that quietly make a will fail, and highlight the points that keep yours clear and valid.',
  'Private by design — your answers stay on your device, and nothing is kept once your will is printed.',
];

function openLegal(page: 'terms' | 'privacy' | 'refund') {
  const path = `/${page}.html`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(path, '_blank', 'noopener');
    return;
  }
  Linking.openURL(`https://sortedwill.co.uk${path}`).catch(() => {});
}

export default function Landing({ onStart, onAccount }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* The homepage is the front door, so the wordmark here is already "home"
          — it stays put rather than navigating anywhere. */}
      <AppHeader onLogoPress={() => {}} onAccount={onAccount} />

      <ScrollView contentContainerStyle={[shared.scrollContent, { paddingBottom: insets.bottom + 48 }]}>
        <View style={styles.column}>
          {/* Hero */}
          <Text style={styles.heroHeading}>Write your will from home, the right way.</Text>
          <Text style={styles.heroSub}>
            A proper will for England and Wales, made from a few plain questions. Free to write
            and review — you only pay when you want to print it.
          </Text>

          <Button label="Start my will" onPress={onStart} />
          <Text style={styles.heroNote}>
            Takes about ten minutes. Nothing to pay to see your finished will.
          </Text>

          {/* How it works */}
          <Text style={styles.sectionTitle}>How it works</Text>
          {STEPS.map((s, i) => (
            <View key={s.title} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepText}>{s.body}</Text>
              </View>
            </View>
          ))}

          {/* Price */}
          <Text style={styles.sectionTitle}>What it costs</Text>
          <View style={styles.priceCard}>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Write and review your will</Text>
              <Text style={styles.priceFree}>Free</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Download it as a PDF to print yourself</Text>
              <Text style={styles.priceAmount}>£10</Text>
            </View>
            <View style={[styles.priceRow, styles.priceRowLast]}>
              <Text style={styles.priceLabel}>We print it and post it to you, first class</Text>
              <Text style={styles.priceAmount}>£14.99</Text>
            </View>
            <Text style={styles.priceFoot}>
              One payment, no subscription. A solicitor-drafted will typically costs £150 or more.
            </Text>
          </View>

          {/* Why */}
          <Text style={styles.sectionTitle}>Why SortedWill</Text>
          <View style={styles.bullets}>
            {WHY.map(line => (
              <View key={line} style={styles.bulletRow}>
                <Text style={styles.bulletMarker}>✓</Text>
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>

          {/* It isn't right for everyone — the same honest guide as the start screen */}
          <Text style={styles.sectionTitle}>It isn't right for everyone</Text>
          <Text style={styles.sectionLead}>
            A home-made will suits most straightforward estates. Some situations need a
            solicitor, and it's better to know before you start. See one instead if:
          </Text>
          <Bullets items={NOT_SUITABLE} marker="✗" color={C.danger} />

          {/* Closing CTA */}
          <Button label="Start my will" onPress={onStart} />

          <Text style={styles.disclaimer}>
            SortedWill makes single wills under the law of England and Wales. It produces a
            document from the answers you give it — it does not read your circumstances, and it
            is not legal advice. The next screen sets out the situations where you should see a
            solicitor instead.
          </Text>

          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => openLegal('terms')}>
              <Text style={styles.legalLink}>Terms</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity onPress={() => openLegal('privacy')}>
              <Text style={styles.legalLink}>Privacy</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>·</Text>
            <TouchableOpacity onPress={() => openLegal('refund')}>
              <Text style={styles.legalLink}>Refunds</Text>
            </TouchableOpacity>
          </View>
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
  column: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  heroHeading: {
    fontSize: 27,
    fontWeight: '800',
    color: C.text,
    lineHeight: 34,
    marginTop: 8,
  },
  heroSub: {
    fontSize: 15,
    color: C.textLight,
    lineHeight: 22,
    marginTop: 10,
  },
  heroNote: {
    fontSize: 12.5,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    marginTop: 32,
    marginBottom: 12,
  },
  sectionLead: {
    fontSize: 13.5,
    color: C.textLight,
    lineHeight: 20,
    marginTop: -2,
    marginBottom: 12,
  },
  step: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  stepBody: {
    flex: 1,
    paddingTop: 2,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginBottom: 3,
  },
  stepText: {
    fontSize: 13.5,
    color: C.textLight,
    lineHeight: 20,
  },
  priceCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.hairline,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.hairline,
    gap: 12,
  },
  priceRowLast: {
    borderBottomWidth: 0,
  },
  priceLabel: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 19,
  },
  priceAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  priceFree: {
    fontSize: 16,
    fontWeight: '700',
    color: C.success,
  },
  priceFoot: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
    marginTop: 12,
  },
  bullets: {
    marginTop: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  bulletMarker: {
    width: 20,
    fontSize: 14,
    fontWeight: '700',
    color: C.success,
    lineHeight: 21,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    lineHeight: 21,
  },
  disclaimer: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
    marginTop: 24,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    gap: 8,
  },
  legalLink: {
    fontSize: 13,
    color: C.primary,
    fontWeight: '600',
  },
  legalDot: {
    fontSize: 13,
    color: C.textLight,
  },
});
