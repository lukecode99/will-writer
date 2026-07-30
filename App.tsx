import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StatusBar,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
} from './src/storage';
import { C, CONTENT_MAX_WIDTH } from './src/screens/shared';
import ProgressHeader from './src/components/ProgressHeader';
import AboutYou from './src/screens/AboutYou';
import PartnerChildren from './src/screens/PartnerChildren';
import Executors from './src/screens/Executors';
import Guardians from './src/screens/Guardians';
import SpecificGifts from './src/screens/SpecificGifts';
import ResiduaryEstate from './src/screens/ResiduaryEstate';
import FuneralWishes from './src/screens/FuneralWishes';
import Review from './src/screens/Review';

// Steps: 0=About, 1=Partner/Children, 2=Executors, 3=Guardians*, 4=Gifts, 5=Residuary, 6=Funeral, 7=Review
// *Guardians shown when there are/may be minor children

function hasMinorChildren(data: WillData): boolean {
  if (data.children.length === 0) return false;
  const now = new Date();
  return data.children.some(c => {
    if (!c.dob) return true;
    const parts = c.dob.split('/');
    if (parts.length !== 3) return true;
    const dob = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    if (isNaN(dob.getTime())) return true;
    const ageMs = now.getTime() - dob.getTime();
    return ageMs / (1000 * 60 * 60 * 24 * 365.25) < 18;
  });
}

/**
 * The wizard itself. Split out from `App` so that its `useState` initialisers,
 * which read the saved draft synchronously, cannot run until storage has been
 * read off disk -- see `hydrateStorage`.
 */
function Wizard() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<WillData>(() => loadWillData());
  const [step, setStep] = useState<number>(() => loadStep());

  const needsGuardians = hasMinorChildren(data);

  const update = useCallback((updates: Partial<WillData>) => {
    setData(prev => {
      const next = { ...prev, ...updates };
      saveWillData(next);
      return next;
    });
  }, []);

  // Persist step
  useEffect(() => {
    saveStep(step);
  }, [step]);

  function nextStep() {
    setStep(prev => {
      let next = prev + 1;
      // Skip guardians (step 3) if no minor children
      if (next === 3 && !needsGuardians) next = 4;
      return next;
    });
  }

  function prevStep() {
    setStep(prev => {
      let back = prev - 1;
      // Skip guardians (step 3) going back if no minor children
      if (back === 3 && !needsGuardians) back = 2;
      return Math.max(0, back);
    });
  }

  function goToStep(n: number) {
    setStep(n);
  }

  function restart() {
    clearWillData();
    setData({ ...EMPTY_WILL });
    setStep(0);
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
  const visibleIndex = (!needsGuardians && step >= 4) ? step - 1 : step;

  const stepTitle = STEP_TITLES[visibleIndex] || 'Review';

  const isReview = step === 7;

  return (
    <View style={styles.root}>
      <ProgressHeader
        step={isReview ? totalVisible - 1 : visibleIndex}
        totalSteps={totalVisible}
        title={isReview ? 'Review' : stepTitle}
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
          {step === 0 && (
            <AboutYou data={data} onChange={update} onNext={nextStep} />
          )}
          {step === 1 && (
            <PartnerChildren data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === 2 && (
            <Executors data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === 3 && (
            <Guardians data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === 4 && (
            <SpecificGifts data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === 5 && (
            <ResiduaryEstate data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === 6 && (
            <FuneralWishes data={data} onChange={update} onNext={nextStep} onBack={prevStep} />
          )}
          {step === 7 && (
            <Review
              data={data}
              onEdit={goToStep}
              onBack={prevStep}
              onRestart={restart}
              hasGuardianStep={needsGuardians}
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
