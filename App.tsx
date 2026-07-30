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
import { WillData, EMPTY_WILL } from './src/types';
import {
  hydrateStorage,
  loadWillData,
  saveWillData,
  loadStep,
  saveStep,
  clearWillData,
  flushWill,
} from './src/storage';
import { notify } from './src/platform';
import { hasMinorChildren } from './src/family';
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

/**
 * The wizard itself. Split out from `App` so that its `useState` initialisers,
 * which read the saved draft synchronously, cannot run until storage has been
 * read off disk -- see `hydrateStorage`.
 */
function Wizard() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<WillData>(() => loadWillData());
  const [step, setStep] = useState<number>(() => loadStep());

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needsGuardians = hasMinorChildren(data);

  const update = useCallback((updates: Partial<WillData>) => {
    setData(prev => {
      const next = { ...prev, ...updates };
      saveWillData(next);
      return next;
    });
    // Answers are autosaved, so a "Saved ✓" left sitting on screen while the
    // user carries on typing would be describing an older draft than the one in
    // front of them. Drop back to the neutral label as soon as anything changes.
    setSaveState(prev => (prev === 'saved' ? 'idle' : prev));
  }, []);

  // Persist step
  useEffect(() => {
    saveStep(step);
  }, [step]);

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

  function restart() {
    clearWillData();
    setData({ ...EMPTY_WILL });
    setStep(0);
    setSaveState('idle');
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
              data={data}
              onEdit={goToStep}
              onBack={prevStep}
              onRestart={restart}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateStorage().then(() => setReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={C.primary} />
      {ready ? (
        <Wizard />
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
