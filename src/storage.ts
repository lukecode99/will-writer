import AsyncStorage from '@react-native-async-storage/async-storage';
import { WillData, EMPTY_WILL, Beneficiary, SpecificGift, SubstitutionType } from './types';

const KEY = 'willWriter.v1';
const STEP_KEY = 'willWriter.step.v1';

/**
 * The draft used to be read straight out of `window.localStorage`. On iOS
 * `window` exists but `window.localStorage` does not, so every read threw, the
 * catch swallowed it, and the app would have opened on a blank will every
 * launch while still appearing to save normally -- a silent data loss rather
 * than a visible error. AsyncStorage works on both platforms (it is backed by
 * localStorage on web, so web behaviour and the existing saved keys are
 * unchanged).
 *
 * AsyncStorage is async, but the draft is read in a `useState` initialiser and
 * written from inside a state updater across eight screens. Rather than make
 * all of those async, the store is read into memory once at startup by
 * `hydrateStorage()` and reads are served from that copy; writes update the
 * copy immediately and flush to disk in the background.
 */
let cachedWill: WillData | null = null;
let cachedStep = 0;
let hydrated = false;

function normalizeBeneficiary(b: any): Beneficiary {
  return {
    id: b.id || Math.random().toString(36).slice(2),
    name: b.name || '',
    relationship: b.relationship || '',
    percentage: b.percentage || '',
    isOwnChild: b.isOwnChild ?? false,
    isMinor: b.isMinor ?? false,
    substitution: b.substitution || { type: 'per-stirpes' as SubstitutionType, namedPerson: '' },
  };
}

function normalizeGift(g: any): SpecificGift {
  return {
    id: g.id || Math.random().toString(36).slice(2),
    recipient: g.recipient || '',
    description: g.description || '',
    isCharity: g.isCharity ?? false,
    // Drafts saved before the tax choice existed had "free of inheritance tax"
    // hardcoded onto every gift. They reopen on the safer default instead, and
    // the user is shown the choice on the Specific Gifts screen.
    taxBurden: g.taxBurden === 'freeOfTax' ? 'freeOfTax' : 'bearsOwnTax',
    substitutionType: g.substitutionType || 'residue',
    substitutionRecipient: g.substitutionRecipient || '',
  };
}

function parseWill(raw: string | null): WillData {
  if (!raw) return { ...EMPTY_WILL };
  const parsed = JSON.parse(raw);
  const merged: WillData = { ...EMPTY_WILL, ...parsed };
  merged.beneficiaries = (merged.beneficiaries || []).map(normalizeBeneficiary);
  merged.specificGifts = (merged.specificGifts || []).map(normalizeGift);
  return merged;
}

/**
 * Reads the saved draft into memory. Must finish before the first render:
 * otherwise the user is shown an empty form over the top of their saved will,
 * and the first keystroke overwrites it.
 */
export async function hydrateStorage(): Promise<void> {
  if (hydrated) return;
  try {
    const [[, will], [, step]] = await AsyncStorage.multiGet([KEY, STEP_KEY]);
    cachedWill = parseWill(will);
    const n = step ? parseInt(step, 10) : 0;
    cachedStep = Number.isNaN(n) ? 0 : n;
  } catch (err) {
    // A corrupt or unreadable draft must not stop the app opening.
    console.warn('Could not read the saved will, starting a new one', err);
    cachedWill = { ...EMPTY_WILL };
    cachedStep = 0;
  }
  hydrated = true;
}

function persist(key: string, value: string): void {
  AsyncStorage.setItem(key, value).catch(err => {
    // There is nothing useful to show the user mid-keystroke, and the
    // in-memory copy is still correct, but an unhandled rejection would take
    // the whole app down.
    console.warn('Could not save the will', err);
  });
}

export function loadWillData(): WillData {
  return cachedWill ? { ...cachedWill } : { ...EMPTY_WILL };
}

export function saveWillData(data: WillData): void {
  cachedWill = data;
  persist(KEY, JSON.stringify(data));
}

export function clearWillData(): void {
  cachedWill = { ...EMPTY_WILL };
  cachedStep = 0;
  AsyncStorage.multiRemove([KEY, STEP_KEY]).catch(err => {
    console.warn('Could not clear the saved will', err);
  });
}

export function loadStep(): number {
  return cachedStep;
}

export function saveStep(step: number): void {
  cachedStep = step;
  persist(STEP_KEY, String(step));
}
