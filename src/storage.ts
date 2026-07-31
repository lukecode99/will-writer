import AsyncStorage from '@react-native-async-storage/async-storage';
import { WillData, EMPTY_WILL, Beneficiary, SpecificGift, SubstitutionType } from './types';

const DOCS_KEY = 'willWriter.docs.v1';
const CORRUPT_KEY = 'willWriter.docs.v1.corrupt';

// The single-will keys this app used before it could hold more than one. Read
// once, at migration, and then left alone: nothing writes to them again, so a
// build that has to be rolled back still finds the draft it left behind.
const LEGACY_KEY = 'willWriter.v1';
const LEGACY_STEP_KEY = 'willWriter.step.v1';

export interface WillDoc {
  id: string;
  data: WillData;
  /** The wizard step this will was last left on. */
  step: number;
  createdAt: number;
  updatedAt: number;
}

/** What the home screen needs to draw the list, without the whole will. */
export interface WillSummary {
  id: string;
  title: string;
  isForSomeoneElse: boolean;
  updatedAt: number;
  step: number;
}

/**
 * The drafts used to be read straight out of `window.localStorage`. On iOS
 * `window` exists but `window.localStorage` does not, so every read threw, the
 * catch swallowed it, and the app would have opened on a blank will every
 * launch while still appearing to save normally -- a silent data loss rather
 * than a visible error. AsyncStorage works on both platforms (it is backed by
 * localStorage on web, so web behaviour is unchanged).
 *
 * AsyncStorage is async, but a draft is read in a `useState` initialiser and
 * written from inside a state updater across eight screens. Rather than make
 * all of those async, the store is read into memory once at startup by
 * `hydrateStorage()` and reads are served from that copy; writes update the
 * copy immediately and flush to disk in the background.
 *
 * All the wills live under one key. That keeps a flush atomic -- there is no
 * window in which the list of wills disagrees with the wills themselves -- and
 * at this size (a handful of documents, a few KB each) rewriting the lot on a
 * keystroke costs nothing.
 */
let docs: WillDoc[] = [];
let hydrated = false;

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

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

function normalizeWill(parsed: any): WillData {
  const merged: WillData = { ...EMPTY_WILL, ...(parsed || {}) };
  merged.beneficiaries = (merged.beneficiaries || []).map(normalizeBeneficiary);
  merged.specificGifts = (merged.specificGifts || []).map(normalizeGift);
  // Drafts saved before the home screen existed were all the user's own will.
  merged.isForSomeoneElse = parsed?.isForSomeoneElse === true;
  return merged;
}

function normalizeDoc(d: any, index: number): WillDoc {
  const now = Date.now();
  return {
    id: typeof d?.id === 'string' && d.id ? d.id : `recovered-${index}-${newId()}`,
    data: normalizeWill(d?.data),
    step: Number.isFinite(d?.step) ? Math.max(0, Math.floor(d.step)) : 0,
    createdAt: Number.isFinite(d?.createdAt) ? d.createdAt : now,
    updatedAt: Number.isFinite(d?.updatedAt) ? d.updatedAt : now,
  };
}

/**
 * Reads the saved drafts into memory. Must finish before the first render:
 * otherwise the user is shown an empty form over the top of a saved will, and
 * the first keystroke overwrites it.
 */
export async function hydrateStorage(): Promise<void> {
  if (hydrated) return;
  try {
    const [[, rawDocs], [, legacyWill], [, legacyStep]] = await AsyncStorage.multiGet([
      DOCS_KEY,
      LEGACY_KEY,
      LEGACY_STEP_KEY,
    ]);

    if (rawDocs) {
      let parsed: any;
      try {
        parsed = JSON.parse(rawDocs);
      } catch (err) {
        // Do not quietly start from nothing on top of something unreadable.
        // Park the bytes where they can still be recovered, and say so.
        console.warn('The saved wills could not be parsed; keeping a copy', err);
        AsyncStorage.setItem(CORRUPT_KEY, rawDocs).catch(() => {});
        parsed = null;
      }
      docs = Array.isArray(parsed) ? parsed.map(normalizeDoc) : [];
    } else if (legacyWill) {
      // One saved will from before this screen existed. It is the user's own.
      const n = legacyStep ? parseInt(legacyStep, 10) : 0;
      const now = Date.now();
      docs = [{
        id: newId(),
        data: normalizeWill(JSON.parse(legacyWill)),
        step: Number.isNaN(n) ? 0 : n,
        createdAt: now,
        updatedAt: now,
      }];
      await AsyncStorage.setItem(DOCS_KEY, JSON.stringify(docs));
    } else {
      docs = [];
    }
  } catch (err) {
    // An unreadable store must not stop the app opening.
    console.warn('Could not read the saved wills', err);
    docs = [];
  }
  hydrated = true;
}

function persist(): void {
  AsyncStorage.setItem(DOCS_KEY, JSON.stringify(docs)).catch(err => {
    // There is nothing useful to show the user mid-keystroke, and the
    // in-memory copy is still correct, but an unhandled rejection would take
    // the whole app down.
    console.warn('Could not save the will', err);
  });
}

function find(id: string): WillDoc | undefined {
  return docs.find(d => d.id === id);
}

/** Most recently edited first — the one you are most likely to want. */
export function listWills(): WillSummary[] {
  return [...docs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(d => ({
      id: d.id,
      title: d.data.fullName.trim(),
      isForSomeoneElse: d.data.isForSomeoneElse,
      updatedAt: d.updatedAt,
      step: d.step,
    }));
}

export function createWill(isForSomeoneElse: boolean): string {
  const now = Date.now();
  const doc: WillDoc = {
    id: newId(),
    data: { ...EMPTY_WILL, isForSomeoneElse },
    step: 0,
    createdAt: now,
    updatedAt: now,
  };
  docs.push(doc);
  persist();
  return doc.id;
}

export function loadWillData(id: string): WillData {
  const doc = find(id);
  return doc ? { ...doc.data } : { ...EMPTY_WILL };
}

export function saveWillData(id: string, data: WillData): void {
  const doc = find(id);
  if (!doc) return;
  doc.data = data;
  doc.updatedAt = Date.now();
  persist();
}

export function deleteWill(id: string): void {
  docs = docs.filter(d => d.id !== id);
  persist();
}

export function loadStep(id: string): number {
  return find(id)?.step ?? 0;
}

export function saveStep(id: string, step: number): void {
  const doc = find(id);
  if (!doc) return;
  doc.step = step;
  persist();
}

/**
 * Writes every draft and waits for it to land, then reads it back to check it
 * is really there.
 *
 * Everything else in this file is fire-and-forget: `persist` swallows failures
 * because there is nothing useful to say to someone mid-keystroke. That is fine
 * for autosave and useless as a promise to the user, so the Save button uses
 * this instead -- it can fail out loud. The read-back matters because
 * `setItem` resolving only means the native module accepted the write; on a
 * device with no space left it can still resolve and store nothing.
 */
export async function flushWill(): Promise<void> {
  const payload = JSON.stringify(docs);
  await AsyncStorage.setItem(DOCS_KEY, payload);
  const back = await AsyncStorage.getItem(DOCS_KEY);
  if (back !== payload) {
    throw new Error('The draft was written but could not be read back');
  }
}
