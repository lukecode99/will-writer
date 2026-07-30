import { WillData, EMPTY_WILL, Beneficiary, SpecificGift, SubstitutionType } from './types';

const KEY = 'willWriter.v1';

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

export function loadWillData(): WillData {
  try {
    if (typeof window === 'undefined') return { ...EMPTY_WILL };
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_WILL };
    const parsed = JSON.parse(raw);
    const merged: WillData = { ...EMPTY_WILL, ...parsed };
    merged.beneficiaries = (merged.beneficiaries || []).map(normalizeBeneficiary);
    merged.specificGifts = (merged.specificGifts || []).map(normalizeGift);
    return merged;
  } catch {
    return { ...EMPTY_WILL };
  }
}

export function saveWillData(data: WillData): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage unavailable
  }
}

export function clearWillData(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

const STEP_KEY = 'willWriter.step.v1';

export function loadStep(): number {
  try {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(STEP_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

export function saveStep(step: number): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STEP_KEY, String(step));
  } catch {
    // ignore
  }
}
