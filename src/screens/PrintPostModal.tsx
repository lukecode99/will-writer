import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { C, shared, CONTENT_MAX_WIDTH } from './shared';
import { notify } from '../platform';
import { createOrder, beginCheckout, PostalAddress } from '../print';

interface Props {
  visible: boolean;
  willId: string;
  defaultAddress: PostalAddress;
  onClose: () => void;
}

const PRICE = '£14.99';

/** Open a static legal page. On web these live at the site root (/terms.html …). */
function openLegal(page: 'terms' | 'privacy' | 'refund') {
  const path = `/${page}.html`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(path, '_blank', 'noopener');
    return;
  }
  Linking.openURL(`https://sortedwill.co.uk${path}`).catch(() => {});
}

/**
 * Collects where to post the pack and the customer's email, then hands off to
 * Stripe Checkout. It never sees the PDF — that is regenerated on-device and
 * uploaded only after payment (see `print.ts` / the paid-return handler in App).
 */
export default function PrintPostModal({ visible, willId, defaultAddress, onClose }: Props) {
  const [name, setName] = useState(defaultAddress.name);
  const [line, setLine] = useState(defaultAddress.line);
  const [postcode, setPostcode] = useState(defaultAddress.postcode);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-seed from the will when the sheet is opened for a different will.
  React.useEffect(() => {
    if (visible) {
      setName(defaultAddress.name);
      setLine(defaultAddress.line);
      setPostcode(defaultAddress.postcode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, willId]);

  const postcodeOk = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode.trim());
  const emailOk = email.trim() === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canPay = name.trim() && line.trim() && postcodeOk && emailOk && !busy;

  // Always available, including mid-checkout: if the user abandons the Stripe
  // tab and comes back, this clears the spinner and closes the sheet.
  function handleCancel() {
    setBusy(false);
    onClose();
  }

  async function pay() {
    if (!canPay) return;
    setBusy(true);
    try {
      const address: PostalAddress = {
        name: name.trim(),
        line: line.trim(),
        postcode: postcode.trim().toUpperCase(),
        country: 'GB',
      };
      const { url, sessionId } = await createOrder({
        email: email.trim() || undefined,
        product: 'print',
      });
      // Stash before leaving for Stripe so the browser round-trip can finish.
      await beginCheckout({ willId, sessionId, product: 'print', address }, url);
      // Native only reaches here (web has navigated away). Leave the sheet up so
      // the user can return and we can complete on next foreground.
    } catch (err) {
      console.error('checkout start failed', err);
      notify('Could not start checkout just now. Please try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={shared.heading}>Print &amp; post your will</Text>
            <Text style={shared.sub}>
              We print your finished will and posting instructions and send them first-class to the
              address below. When it arrives, sign it in front of two witnesses. {PRICE}, one-off.
            </Text>

            <Text style={shared.label}>Send it to</Text>
            <TextInput
              style={shared.input}
              placeholder="Recipient name"
              value={name}
              onChangeText={setName}
            />

            <Text style={shared.label}>Address</Text>
            <TextInput
              style={[shared.input, shared.inputMulti]}
              placeholder="House and street, town"
              value={line}
              onChangeText={setLine}
              multiline
            />

            <Text style={shared.label}>Postcode</Text>
            <TextInput
              style={[shared.input, !postcodeOk && postcode ? shared.inputError : null]}
              placeholder="e.g. HA4 9QJ"
              value={postcode}
              onChangeText={setPostcode}
              autoCapitalize="characters"
            />
            {!postcodeOk && postcode ? (
              <Text style={shared.error}>That does not look like a UK postcode.</Text>
            ) : null}

            <Text style={shared.label}>Email for your dispatch confirmation (optional)</Text>
            <TextInput
              style={[shared.input, !emailOk ? shared.inputError : null]}
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {!emailOk ? <Text style={shared.error}>Check the email address.</Text> : null}

            <Text style={styles.notice}>
              Your will is printed to your exact specification, so the 14-day cancellation right
              does not apply once it has gone to print. We refund in full if it has not yet printed.
              We keep no copy of your will.
            </Text>

            <TouchableOpacity
              style={[shared.primaryBtn, !canPay ? shared.btnDisabled : null]}
              onPress={pay}
              disabled={!canPay}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={shared.primaryBtnText}>Pay {PRICE} &amp; post</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancel} onPress={handleCancel}>
              <Text style={styles.cancelText}>{busy ? 'Cancel' : 'Not now'}</Text>
            </TouchableOpacity>

            <View style={styles.legalRow}>
              <Text style={styles.legalText}>By paying you agree to our </Text>
              <TouchableOpacity onPress={() => openLegal('terms')}>
                <Text style={styles.legalLink}>Terms</Text>
              </TouchableOpacity>
              <Text style={styles.legalText}>, </Text>
              <TouchableOpacity onPress={() => openLegal('refund')}>
                <Text style={styles.legalLink}>Refund Policy</Text>
              </TouchableOpacity>
              <Text style={styles.legalText}> and </Text>
              <TouchableOpacity onPress={() => openLegal('privacy')}>
                <Text style={styles.legalLink}>Privacy Policy</Text>
              </TouchableOpacity>
              <Text style={styles.legalText}>.</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '92%',
  },
  content: {
    padding: 20,
    paddingBottom: 36,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  notice: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
    marginTop: 18,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  cancelText: {
    color: C.textLight,
    fontSize: 15,
    fontWeight: '600',
  },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 8,
  },
  legalText: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
  },
  legalLink: {
    fontSize: 12,
    color: C.primary,
    fontWeight: '600',
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
});
