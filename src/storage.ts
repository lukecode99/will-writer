import { WillData, EMPTY_WILL } from './types';

const KEY = 'willWriter.v1';

export function loadWillData(): WillData {
  try {
    if (typeof window === 'undefined') return { ...EMPTY_WILL };
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_WILL };
    return { ...EMPTY_WILL, ...JSON.parse(raw) };
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
