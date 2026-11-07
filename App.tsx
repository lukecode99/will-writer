import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  AppState,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WillData } from './src/types';
import {
  hydrateStorage,
  loadWillData,
  saveWillData,
  loadStep,
  saveStep,
  flushWill,
  onPersistFailure,
  listWills,
  createWill,
  deleteWill,
  WillSummary,
  listPrintedWills,
  recordPrintedWill,
  setSyncedPrintedWills,
  PrintedWill,
} from './src/storage';
import { notify, deliverPdf } from './src/platform';
import { generateWillPdf } from './src/pdfGen';
import {
  peekReturnedSession,
  clearReturnParam,
  readPending,
  clearPending,
  submitPrint,
  verifyDownload,
  unlockDownload,
  loadAccount,
  verifyLogin,
  logoutAccount,
  fetchAccountOrders,
  peekLoginToken,
  Account as AccountModel,
} from './src/print';
import { hasMinorChildren } from './src/family';
import { syncLinkedBeneficiaries } from './src/people';
import { StepKey } from './src/validation';
import { C, CONTENT_MAX_WIDTH } from './src/screens/shared';
import ProgressHeader, { SaveState } from './src/components/ProgressHeader';
import AboutYou from './src/screens/AboutYou';
import PartnerChildren from './src/screens/PartnerChildren';
import Executors from './src/screens/Executors';
import Guardians from './src/screens/Guardians';
import SpecificGifts from './src/screens/SpecificGifts';
import ResiduaryEstate from './src/screens/ResiduaryEstate';
import FuneralWishes from './src/screens/FuneralWishes';
import Review from './src/screens/Review';
import Home from './src/screens/Home';
import Landing from './src/screens/Landing';
import Account from './src/screens/Account';

/**
 * The wizard's steps, by absolute index.
 *
 * Guardians is conditional, so there are two different numberings in play: the
 * absolute one below, which decides what renders, and the visible one, which
 * decides what the progress bar says. Review used to hand back a *visible*
 * index, which `setStep` then treated as absolute — so with the guardians step
 * hidden, "Edit specific gifts" opened the guardians screen and told a childless
 * user about their minor children. Navigation is therefore by name; the mapping
 * from name to index exists in exactly one place.
 */
const STEP: Record<StepKey, number> = {
  about: 0,
  family: 1,
  executors: 2,
  guardians: 3,
  gifts: 4,
  residuary: 5,
  funeral: 6,
  review: 7,
};

interface WizardProps {
  /** Which saved will is being edited. Mounted under `key={id}`, so the
   *  `useState` initialisers below re-read storage when it changes. */
  id: string;
  onHome: () => void;
}

/**
 * The wizard itself. Split out from `App` so that its `useState` initialisers,
 * which read the saved draft synchronously, cannot run until storage has been
 * read off disk -- see `hydrateStorage`.
 */
function Wizard({ id, onHome }: WizardProps) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<WillData>(() => loadWillData(id));
  // Clamped on the way in: a stored step past Review — an older build with
  // more steps, or a bad write — matches no screen at all, and the wizard
  // renders a header over nothing.
  const [step, setStep] = useState<number>(() =>
    Math.min(STEP.review, Math.max(0, loadStep(id))),
  );

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needsGuardians = hasMinorChildren(data);

  const update = useCallback((updates: Partial<WillData>) => {
    setData(prev => {
      // Every change goes through here, which is the only place that sees an
      // edit to the family details and an edit to the beneficiary list as the
      // same event. Correcting a child's name on the Family step has to reach
      // the share left to that child, and there is no other single point where
      // both are in hand.
      const next = syncLinkedBeneficiaries({ ...prev, ...updates });
      saveWillData(id, next);
      return next;
    });
    // Answers are autosaved, so a "Saved ✓" left sitting on screen while the
    // user carries on typing would be describing an older draft than the one in
    // front of them. Drop back to the neutral label as soon as anything changes.
    setSaveState(prev => (prev === 'saved' ? 'idle' : prev));
  }, [id]);

  // Persist step
  useEffect(() => {
    saveStep(id, step);
  }, [id, step]);

  const save = useCallback(async () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setSaveState('saving');
    try {
      await flushWill();
      setSaveState('saved');
      resetTimer.current = setTimeout(() => setSaveState('idle'), 3000);
    } catch (err) {
      console.warn('Explicit save failed', err);
      setSaveState('error');
      notify(
        'Your answers could not be saved to this device. Check you have free storage space, then try again.',
        'Not saved',
      );
    }
  }, []);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  // One failed background write is a blip. Three in a row means nothing has
  // reached disk for a while, and the person typing their will deserves to
  // know before they close the app. Said once per streak; a successful write
  // re-arms it and clears the header's error state.
  const persistWarned = useRef(false);
  useEffect(() => {
    onPersistFailure(consecutive => {
      if (consecutive === 0) {
        persistWarned.current = false;
        setSaveState(prev => (prev === 'error' ? 'idle' : prev));
        return;
      }
      if (consecutive >= 3 && !persistWarned.current) {
        persistWarned.current = true;
        setSaveState('error');
        notify(
          'Your answers are not being saved to this device — the last few attempts all failed. Check you have free storage space. Anything you type is only safe while the app stays open.',
          'Not saving',
        );
      }
    });
    return () => onPersistFailure(null);
  }, []);

  // Autosave writes on every keystroke, but the last one before the app is
  // backgrounded can still be in flight when iOS suspends the process. Flushing
  // on the way out closes that window; failures are silent here because there is
  // no screen left to show them on.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background' || next === 'inactive') {
        flushWill().catch(err => console.warn('Background flush failed', err));
      }
    });
    return () => sub.remove();
  }, []);

  function nextStep() {
    setStep(prev => {
      let next = prev + 1;
      if (next === STEP.guardians && !needsGuardians) next = STEP.gifts;
      return Math.min(STEP.review, next);
    });
  }

  function prevStep() {
    setStep(prev => {
      let back = prev - 1;
      if (back === STEP.guardians && !needsGuardians) back = STEP.executors;
      return Math.max(0, back);
    });
  }

  // Review's edit links, and the links inside its problem list, address steps by
  // name. Guardians stays reachable by name even when it is skipped in the
  // forward flow, because a stale guardian left over from a corrected date of
  // birth has to be editable to be removed.
  function goToStep(key: StepKey) {
    setStep(STEP[key]);
  }

  // Leaving a will is not the same as discarding it. Answers are already
  // autosaved, but the last keystroke can still be in flight, so the flush
  // happens before the list is rebuilt from storage — otherwise the home screen
  // can show a stale name for the will that was just being edited.
  function leave() {
    flushWill()
      .catch(err => console.warn('Flush on leaving failed', err))
      .finally(onHome);
  }

  const STEP_TITLES = [
    'About You',
    'Family',
    'Executors',
    needsGuardians ? 'Guardians' : undefined,
    'Specific Gifts',
    'Residuary',
    'Funeral Wishes',
    'Review',
  ].filter(Boolean) as string[];

  const totalVisible = needsGuardians ? 8 : 7;
  const visibleIndex = (!needsGuardians && step >= STEP.gifts) ? step - 1 : step;

  const stepTitle = STEP_TITLES[visibleIndex] || 'Review';

  const isReview = step === STEP.review;

  return (
    <View style={styles.root}>
      <ProgressHeader
        step={isReview ? totalVisible - 1 : visibleIndex}
        totalSteps={totalVisible}
        title={isReview ? 'Review' : stepTitle}
        saveState={saveState}
        onSave={save}
        onHome={leave}
        subject={
          data.isForSomeoneElse
            ? `${data.fullName.trim() || 'Their'}${data.fullName.trim() ? "'s" : ''} will`
            : undefined
        }
      />

      {/* Without this the keyboard covers the lower half of every form, and
          the field being typed into is one of the ones it covers. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* On an iPad a full-width form is a single line of text stretched
            across 10 inches. Cap it and centre it; the gutters take the same
            background so it reads as a page, not a floating panel. */}
        <View style={[styles.column, { paddingBottom: insets.bottom }]}>
          {step === STEP.about && (
            <AboutYou data={data} onChange={update} onNext={nextStep} />
          )}
          {step === STEP.family && (
            <PartnerChildren data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === STEP.executors && (
            <Executors data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === STEP.guardians && (
            <Guardians data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === STEP.gifts && (
            <SpecificGifts data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === STEP.residuary && (
            <ResiduaryEstate data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === STEP.funeral && (
            <FuneralWishes data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === STEP.review && (
            <Review
              id={id}
              data={data}
              onEdit={goToStep}
              onBack={prevStep}
              onRestart={leave}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [wills, setWills] = useState<WillSummary[]>([]);
  const [printed, setPrinted] = useState<PrintedWill[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Which screen stands in for "no will open": the marketing homepage, the
  // start / saved-wills screen, or the account screen. A first-time visitor gets
  // the homepage; someone who already has a draft on the device is a returning
  // user mid-will, so they skip straight to their wills rather than being
  // re-sold the service.
  const [view, setView] = useState<'landing' | 'home' | 'account'>('landing');
  // The signed-in account, if any. An account syncs only the record of printed
  // orders across devices — never a will. Held here so the Account screen and
  // the printed-wills list stay in step.
  const [account, setAccount] = useState<AccountModel | null>(null);

  // Pull the account's synced printed-order records into the printed list.
  // Called after sign-in and on launch while signed in; failures (offline, or an
  // expired session already cleared by fetchAccountOrders) simply leave the
  // local list as it is.
  const syncAccountOrders = useCallback(async () => {
    const orders = await fetchAccountOrders();
    if (orders) {
      setSyncedPrintedWills(orders);
      setPrinted(listPrintedWills());
    }
  }, []);

  useEffect(() => {
    hydrateStorage().then(async () => {
      setWills(listWills());
      setPrinted(listPrintedWills());
      const acct = await loadAccount();
      if (acct) {
        setAccount(acct);
        syncAccountOrders();
      }
      // The marketing homepage is the front door for everyone — first-time
      // visitor and returning user alike. A returning user is one tap from their
      // wills (the primary button, or the logo), and the homepage is the page we
      // want indexed and shared, so it is what the bare domain serves. The one
      // exception is a return from Stripe Checkout, handled below, which routes
      // straight to the wills so a paid order is never stranded behind the pitch.
      setView('landing');
      setReady(true);
    });
  }, []);

  // Coming back from Stripe Checkout (web). The PDF was never uploaded before
  // payment — it is regenerated here from the still-stored will and streamed to
  // the printer. The worker is idempotent per session, so a refresh mid-flow
  // cannot print twice; we only strip the ?session_id once submission succeeds.
  useEffect(() => {
    if (!ready) return;
    const sessionId = peekReturnedSession();
    if (!sessionId) return;
    (async () => {
      const pending = await readPending();
      if (!pending || pending.sessionId !== sessionId) {
        clearReturnParam();
        await clearPending();
        return;
      }
      // A return from Checkout is a paid customer, not a fresh visitor: route
      // them off the marketing front door and onto their wills, where the print
      // confirmation and the "Your printed wills" record will land.
      setView('home');
      try {
        const willData = loadWillData(pending.willId);
        const bytes = await generateWillPdf(willData);

        if (pending.product === 'download') {
          // Paid digital download: confirm payment, then deliver on-device.
          // Nothing is uploaded and no copy is kept.
          const res = await verifyDownload(sessionId);
          await unlockDownload(pending.willId);
          await deliverPdf(
            bytes,
            `Will_${willData.fullName.replace(/\s+/g, '_') || 'Draft'}.pdf`,
          );
          clearReturnParam();
          await clearPending();
          notify(
            res.testmode
              ? 'Test order complete — test mode, so nothing was charged. Your download is unlocked.'
              : 'Payment received — your will has downloaded, and you can download it again any time.',
            res.testmode ? 'Test order complete' : 'Downloaded',
          );
          return;
        }

        const res = await submitPrint({ sessionId, bytes, address: pending.address! });
        // A print purchase also unlocks the download for that will (no double charge).
        await unlockDownload(pending.willId);
        // A real order joins the printed list on this device, so it shows up
        // under "Your printed wills" with its date and delivery estimate. A test
        // order posts nothing, so it is deliberately not recorded.
        if (!res.testmode) {
          recordPrintedWill({
            willId: pending.willId,
            title: willData.fullName.trim(),
            letterId: res.letterId,
            printedAt: Date.now(),
          });
          setPrinted(listPrintedWills());
        }
        clearReturnParam();
        await clearPending();
        notify(
          res.testmode
            ? 'Test order complete — submitted in test mode, so nothing was charged and nothing is posted.'
            : 'Payment received. Your will is being printed and will be posted first-class. We keep no copy of your will.',
          res.testmode ? 'Test order complete' : 'On its way',
        );
      } catch (err) {
        // Leave ?session_id and the pending record in place: a reload retries,
        // and the worker will not double-charge or double-print.
        console.error('print completion failed', err);
        notify(
          'Your payment went through, but submitting your will for printing did not complete. Reload this page to try again — you will not be charged again.',
          'Almost there',
        );
      }
    })();
  }, [ready]);

  // Arriving on an emailed sign-in link (`/?login=<token>`, web). Exchange the
  // one-time token for a session, pull the account's synced orders, and land on
  // the account screen so the sign-in reads as having worked. The token is
  // stripped from the URL either way, so a refresh cannot replay a spent link.
  useEffect(() => {
    if (!ready) return;
    const token = peekLoginToken();
    if (!token) return;
    (async () => {
      try {
        const acct = await verifyLogin(token);
        setAccount(acct);
        await syncAccountOrders();
        setView('account');
      } catch (err) {
        console.warn('sign-in link failed', err);
        // A spent or expired link is the common case, not an error worth a
        // modal: drop them on the account screen signed-out, where they can ask
        // for a fresh link.
        setView('account');
        notify(
          'That sign-in link has expired or already been used. Enter your email to get a new one.',
          'Link expired',
        );
      } finally {
        clearReturnParam();
      }
    })();
  }, [ready]);

  function open(id: string) {
    setActiveId(id);
  }

  function create(isForSomeoneElse: boolean) {
    setActiveId(createWill(isForSomeoneElse));
  }

  function remove(id: string) {
    deleteWill(id);
    setWills(listWills());
  }

  // The list is rebuilt on the way out rather than kept in sync while editing:
  // it is only ever on screen when no will is open, and rebuilding it on every
  // keystroke would re-render the whole home screen behind the wizard.
  function goHome() {
    setActiveId(null);
    setWills(listWills());
    setPrinted(listPrintedWills());
    // Coming out of a will, the start / saved-wills screen is the right place
    // to land — never back to the marketing homepage.
    setView('home');
  }

  // Sign out: drop the local session, clear the synced orders from memory (so a
  // shared device never leaves one person's order list for the next), rebuild
  // the printed list from this device's own records, and return to the wills.
  async function logout() {
    await logoutAccount();
    setAccount(null);
    setSyncedPrintedWills([]);
    setPrinted(listPrintedWills());
    setView('home');
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      {ready ? (
        activeId ? (
          // Keyed by id so that opening a different will remounts the wizard,
          // which is what re-runs the initialisers that read it out of storage.
          <Wizard key={activeId} id={activeId} onHome={goHome} />
        ) : view === 'landing' ? (
          <Landing onStart={() => setView('home')} onAccount={() => setView('account')} />
        ) : view === 'account' ? (
          <Account
            account={account}
            onLogoPress={() => setView('landing')}
            onLogout={logout}
          />
        ) : (
          <Home
            wills={wills}
            printed={printed}
            onCreate={create}
            onOpen={open}
            onDelete={remove}
            onLogoPress={() => setView('landing')}
            onAccount={() => setView('account')}
          />
        )
      ) : (
        // Same navy as the splash screen, so the handover is invisible rather
        // than a white flash between the two.
        <View style={styles.loading}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  flex: {
    flex: 1,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  loading: {
    flex: 1,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
