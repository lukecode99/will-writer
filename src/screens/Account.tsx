import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Account as AccountType, requestLogin, requestOtp, verifyOtp } from '../print';
import { C, shared, CONTENT_MAX_WIDTH } from './shared';
import AppHeader from '../components/AppHeader';

interface Props {
  account: AccountType | null;
  onLogoPress: () => void;
  onLogout: () => void;
  /** iOS completes sign-in in-app (code entry), so the screen hands the fresh
   *  account back up to App to store in state and sync orders. Unused on web,
   *  where the emailed link drives sign-in from App itself. */
  onSignedIn?: (account: AccountType) => void;
}

/** iOS signs in with a 6-digit code typed back into the app; web uses an emailed
 *  magic link. The only reason to branch is that iOS has no browser to catch the
 *  link, so the two platforms genuinely differ here. */
const USE_OTP = Platform.OS !== 'web';

/** A light client-side check so an obvious typo gets caught before a round-trip.
 *  The worker is the real gate; this only stops "no @" reaching it. */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default function Account({ account, onLogoPress, onLogout, onSignedIn }: Props) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // iOS code-entry state (unused on web).
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const invalid = touched && !looksLikeEmail(email);

  async function send() {
    if (!looksLikeEmail(email)) {
      setTouched(true);
      return;
    }
    setSending(true);
    try {
      if (USE_OTP) {
        await requestOtp(email.trim());
      } else {
        await requestLogin(email.trim());
      }
    } finally {
      // Neither request rejects — both deliberately read the same whether or not
      // the address has an account, so there is nothing to branch on. Either way
      // the next screen is "check your email" (web) / "enter your code" (iOS).
      setSending(false);
      setCode('');
      setCodeError(null);
      setSent(true);
    }
  }

  async function verify() {
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) {
      setCodeError('Enter the 6-digit code from your email.');
      return;
    }
    setVerifying(true);
    setCodeError(null);
    try {
      const acct = await verifyOtp(email.trim(), c);
      onSignedIn?.(acct);
    } catch (err: any) {
      if (err?.code === 'too_many_attempts') {
        setCodeError('Too many tries. Ask for a new code.');
      } else {
        setCodeError('That code was wrong or has expired. Check it and try again.');
      }
      setCode('');
    } finally {
      setVerifying(false);
    }
  }

  function startOver() {
    setSent(false);
    setTouched(false);
    setCode('');
    setCodeError(null);
  }

  return (
    <View style={styles.root}>
      {/* Already on the account page, so the Account control is the current
          page, not a link — it reads as active and does nothing when tapped. */}
      <AppHeader
        onLogoPress={onLogoPress}
        onAccount={() => {}}
        accountActive
        accountInitial={account?.email}
      />

      <ScrollView contentContainerStyle={[shared.scrollContent, { paddingBottom: insets.bottom + 48 }]}>
        <View style={styles.column}>
          {account ? (
            <>
              <Text style={shared.heading}>You're signed in</Text>
              <Text style={shared.sub}>
                Signed in as {account.email}. The record of any will you have printed and posted
                will show up here and on your other devices.
              </Text>

              <View style={shared.card}>
                <Text style={styles.cardLabel}>What an account keeps</Text>
                <Text style={styles.cardBody}>
                  Only the record of your printed orders — the order date and a reference number —
                  so you can see them on another device. It does not keep your will, your name, or
                  anything you typed into it. Those stay on the device you wrote them on, exactly as
                  before. Signing out here removes the synced record from this device.
                </Text>
              </View>

              <TouchableOpacity
                style={shared.secondaryBtn}
                onPress={onLogout}
                accessibilityRole="button"
              >
                <Text style={shared.secondaryBtnText}>Sign out</Text>
              </TouchableOpacity>
            </>
          ) : sent && USE_OTP ? (
            <>
              <Text style={shared.heading}>Enter your code</Text>
              <Text style={shared.sub}>
                If {email.trim()} is a SortedWill account, a 6-digit code is on its way. Type it in
                below to sign in. The code works once and lasts 10 minutes.
              </Text>

              <Text style={shared.label}>6-digit code</Text>
              <TextInput
                style={[shared.input, styles.codeInput, codeError ? shared.inputError : null]}
                value={code}
                onChangeText={(t) => {
                  setCode(t.replace(/\D/g, '').slice(0, 6));
                  if (codeError) setCodeError(null);
                }}
                placeholder="123456"
                placeholderTextColor={C.textLight}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                editable={!verifying}
                accessibilityLabel="6-digit sign-in code"
              />
              {codeError ? <Text style={shared.error}>{codeError}</Text> : null}

              <TouchableOpacity
                style={[shared.primaryBtn, verifying ? shared.btnDisabled : null]}
                onPress={verify}
                disabled={verifying}
                accessibilityRole="button"
              >
                <Text style={shared.primaryBtnText}>{verifying ? 'Checking…' : 'Sign in'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={shared.secondaryBtn}
                onPress={startOver}
                accessibilityRole="button"
              >
                <Text style={shared.secondaryBtnText}>Use a different email</Text>
              </TouchableOpacity>
            </>
          ) : sent ? (
            <>
              <Text style={shared.heading}>Check your email</Text>
              <Text style={shared.sub}>
                If {email.trim()} is a SortedWill account, a sign-in link is on its way. Open it on
                this device to sign in. The link works once and lasts 15 minutes.
              </Text>
              <TouchableOpacity
                style={shared.secondaryBtn}
                onPress={startOver}
                accessibilityRole="button"
              >
                <Text style={shared.secondaryBtnText}>Use a different email</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={shared.heading}>Sign in</Text>
              <Text style={shared.sub}>
                An account syncs the record of your printed wills across your devices — nothing
                else. There's no password: {USE_OTP ? 'we email you a 6-digit code to sign in' : 'we email you a link to sign in'}.
              </Text>

              <Text style={shared.label}>Your email</Text>
              <TextInput
                style={[shared.input, invalid ? shared.inputError : null]}
                value={email}
                onChangeText={setEmail}
                onBlur={() => setTouched(true)}
                placeholder="you@example.com"
                placeholderTextColor={C.textLight}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!sending}
                accessibilityLabel="Your email address"
              />
              {invalid ? <Text style={shared.error}>Enter a valid email address.</Text> : null}

              <TouchableOpacity
                style={[shared.primaryBtn, sending ? shared.btnDisabled : null]}
                onPress={send}
                disabled={sending}
                accessibilityRole="button"
              >
                <Text style={shared.primaryBtnText}>
                  {sending ? 'Sending…' : USE_OTP ? 'Email me a code' : 'Email me a sign-in link'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.privacyNote}>
                Use the same email you gave when you ordered a printed will. That's how your orders
                find their way back to you. We keep no copy of your will.
              </Text>
            </>
          )}
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
  cardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 13,
    color: C.textLight,
    lineHeight: 19,
  },
  privacyNote: {
    fontSize: 12,
    color: C.textLight,
    lineHeight: 18,
    marginTop: 20,
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '700',
  },
});
