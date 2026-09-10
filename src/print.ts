/**
 * Print-and-post client.
 *
 * The will PDF is generated on the device and only leaves it once, streamed
 * through the worker to the printer. This module talks to that worker and, on
 * web, survives the round-trip to Stripe Checkout: it stashes just enough to
 * finish the job when the browser comes back to `/paid?session_id=...`.
 *
 * It deliberately holds NO will content — only which local will to regenerate,
 * the paid session id, and the postal address the user typed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/** Where the worker lives. Set at build time; falls back to the deployed URL. */
export const PRINT_API =
  (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_PRINT_API) ||
  'https://sortedwill-print.lukecode99.workers.dev';

export interface PostalAddress {
  name: string;
  line: string;
  postcode: string;
  country: string; // ISO-ish; Intelliprint takes "GB"
}

const PENDING_KEY = 'sortedwill.pendingPrint.v1';

interface PendingPrint {
  willId: string;
  sessionId: string;
  address: PostalAddress;
}

/** Create a Stripe Checkout Session. Price is fixed by the worker, never here. */
export async function createOrder(email?: string): Promise<{ url: string; sessionId: string }> {
  const res = await fetch(`${PRINT_API}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email ? { email } : {}),
  });
  if (!res.ok) throw new Error(`order failed (${res.status})`);
  const data = await res.json();
  if (!data.url || !data.sessionId) throw new Error('order returned no checkout url');
  return data;
}

/**
 * Upload the PDF against a paid session. The worker re-checks payment with
 * Stripe and is idempotent per session, so a retry after a dropped response is
 * safe and will not print twice.
 */
export async function submitPrint(args: {
  sessionId: string;
  bytes: Uint8Array;
  address: PostalAddress;
}): Promise<{ ok: boolean; letterId: string; testmode?: boolean }> {
  const form = new FormData();
  // React Native's FormData wants a {uri,name,type} shape; web wants a Blob.
  const blob = new Blob([args.bytes], { type: 'application/pdf' });
  form.append('file', blob as any, 'will.pdf');
  form.append('sessionId', args.sessionId);
  form.append('name', args.address.name);
  form.append('line', args.address.line);
  form.append('postcode', args.address.postcode);
  form.append('country', args.address.country || 'GB');

  const res = await fetch(`${PRINT_API}/send`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `send failed (${res.status})`);
    (err as any).code = data.error;
    (err as any).status = res.status;
    throw err;
  }
  return data;
}

/* ---- web round-trip survival ---------------------------------------- */

export async function stashPending(p: PendingPrint): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(p));
}

export async function readPending(): Promise<PendingPrint | null> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingPrint;
  } catch {
    return null;
  }
}

export async function clearPending(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

/**
 * On web, after Stripe redirects back to `/paid?session_id=...`, read that id
 * WITHOUT scrubbing it. Leaving it in the URL means a refresh re-fires the
 * submit, which is safe because the worker is idempotent per session — a far
 * better failure mode than losing a paid-but-unsubmitted order. The param is
 * stripped explicitly with `clearReturnParam()` only once submission succeeds.
 * Returns null on native or when there is no session in the URL.
 */
export function peekReturnedSession(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('session_id');
}

export function clearReturnParam(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const clean = window.location.origin + window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', clean);
  } catch {
    /* history API unavailable — harmless */
  }
}

/** Begin checkout. On web this redirects the page; it does not return. */
export async function beginCheckout(pending: PendingPrint, url: string): Promise<void> {
  await stashPending(pending);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.href = url;
    return;
  }
  // Native has no in-app browser dependency here yet; open the system browser.
  // A clean return into the app for auto-submit needs expo-web-browser + a
  // deep-link scheme — tracked as the native follow-up.
  const { Linking } = require('react-native');
  await Linking.openURL(url);
}

/** Best-effort UK postcode split out of a single free-text address string. */
export function splitAddress(fullName: string, address: string): PostalAddress {
  const trimmed = (address || '').trim();
  const pcMatch = trimmed.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*$/i);
  const postcode = pcMatch ? pcMatch[1].toUpperCase().replace(/\s+/g, ' ') : '';
  const line = pcMatch ? trimmed.slice(0, pcMatch.index).replace(/[,\s]+$/, '') : trimmed;
  return { name: (fullName || '').trim(), line, postcode, country: 'GB' };
}
