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
  'https://sortedwill-print.nanoluke521.workers.dev';

export interface PostalAddress {
  name: string;
  line: string;
  postcode: string;
  country: string; // ISO-ish; Intelliprint takes "GB"
}

const PENDING_KEY = 'sortedwill.pendingPrint.v1';
const DOWNLOAD_UNLOCK_PREFIX = 'sortedwill.downloadPaid.v1.';

export type Product = 'print' | 'download';

interface PendingPrint {
  willId: string;
  sessionId: string;
  product: Product;
  // Present for print orders; omitted for a paid download.
  address?: PostalAddress;
}

/** Create a Stripe Checkout Session. Price + product are fixed by the worker. */
export async function createOrder(opts?: {
  email?: string;
  product?: Product;
}): Promise<{ url: string; sessionId: string }> {
  const body: Record<string, string> = {};
  if (opts?.email) body.email = opts.email;
  if (opts?.product) body.product = opts.product;
  const res = await fetch(`${PRINT_API}/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`order failed (${res.status})`);
  const data = await res.json();
  if (!data.url || !data.sessionId) throw new Error('order returned no checkout url');
  return data;
}

/**
 * Confirm a paid £10 download session with the worker (which re-checks Stripe).
 * Unlike print, nothing is uploaded — the PDF is delivered on-device — so this
 * is the payment gate before we regenerate and hand over the file.
 */
export async function verifyDownload(sessionId: string): Promise<{ ok: boolean; testmode?: boolean }> {
  const res = await fetch(`${PRINT_API}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || `verify failed (${res.status})`);
    (err as any).code = data.error;
    throw err;
  }
  return data;
}

/* ---- download entitlement (per will, on this device) ---------------- */

export async function unlockDownload(willId: string): Promise<void> {
  await AsyncStorage.setItem(DOWNLOAD_UNLOCK_PREFIX + willId, '1');
}

export async function isDownloadUnlocked(willId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(DOWNLOAD_UNLOCK_PREFIX + willId)) === '1';
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

/* ---- account (magic-link login) ------------------------------------- */

/**
 * The account is deliberately thin. It exists to sync ONE thing across a user's
 * devices: the record of wills they have had printed (an id, a date, a product
 * — never the will, never a name). Auth is a magic link, so there is no password
 * to store or lose, and losing the account loses nothing but that order list.
 */
const ACCOUNT_KEY = 'sortedwill.account.v1';

// On iOS the session token is the one secret worth protecting, so it lives in
// the Keychain (via expo-secure-store) rather than AsyncStorage's plist. The
// email is not sensitive and stays in AsyncStorage so a signed-in UI can show
// it without unlocking the Keychain. On web there is no Keychain, so the whole
// account stays in AsyncStorage exactly as before. expo-secure-store is a native
// module with no web implementation, so it is required lazily, never on web.
const SecureStore: any = Platform.OS === 'web' ? null : require('expo-secure-store');
const SESSION_TOKEN_KEY = 'sw_session_token'; // iOS Keychain item
const ACCOUNT_EMAIL_KEY = 'sortedwill.account.email.v1'; // non-secret

export interface Account {
  email: string;
  sessionToken: string;
}

/** Persist the signed-in account, Keychain-backed on iOS, AsyncStorage on web. */
async function persistAccount(account: Account): Promise<void> {
  if (Platform.OS === 'web' || !SecureStore) {
    await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    return;
  }
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, account.sessionToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await AsyncStorage.setItem(ACCOUNT_EMAIL_KEY, account.email);
}

/** Wipe the signed-in account from whichever store holds it. */
async function clearAccountStore(): Promise<void> {
  if (Platform.OS === 'web' || !SecureStore) {
    await AsyncStorage.removeItem(ACCOUNT_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY).catch(() => {});
  await AsyncStorage.removeItem(ACCOUNT_EMAIL_KEY);
}

/** A printed-order record as the worker syncs it: no will content, no name. */
export interface SyncedOrder {
  letterId: string;
  printedAt: number;
  product?: string;
}

/**
 * Ask the worker to email a login link. Always resolves the same way: the
 * worker never reveals whether an address has an account, so there is nothing
 * to branch on here — the UI just says "check your email" regardless.
 */
export async function requestLogin(email: string): Promise<void> {
  await fetch(`${PRINT_API}/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).catch(() => {
    /* A failed request must still read as "check your email": no enumeration,
       and a transient network error should not tell the user their address is
       special. A genuinely undelivered link is recoverable by asking again. */
  });
}

/** Exchange a one-time login token (from the emailed link) for a session. */
export async function verifyLogin(token: string): Promise<Account> {
  const res = await fetch(`${PRINT_API}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !data.sessionToken || !data.email) {
    const err = new Error(data.error || `login failed (${res.status})`);
    (err as any).code = data.error;
    throw err;
  }
  const account: Account = { email: data.email, sessionToken: data.sessionToken };
  await persistAccount(account);
  return account;
}

/**
 * iOS sign-in, step 1: ask the worker to email a 6-digit code. Like
 * requestLogin, always resolves the same way regardless of whether the address
 * has an account — the UI just moves to the "enter code" state.
 */
export async function requestOtp(email: string): Promise<void> {
  await fetch(`${PRINT_API}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).catch(() => {
    /* Same reasoning as requestLogin: a transient failure must still read as
       "we sent a code" — no enumeration, and the user can ask again. */
  });
}

/**
 * iOS sign-in, step 2: exchange the typed code for a session. Throws with a
 * `code` of 'wrong_code' / 'too_many_attempts' / 'invalid' so the screen can
 * tell "that code was wrong" apart from "ask for a new one".
 */
export async function verifyOtp(email: string, code: string): Promise<Account> {
  const res = await fetch(`${PRINT_API}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !data.sessionToken || !data.email) {
    const err = new Error(data.error || `login failed (${res.status})`);
    (err as any).code = data.error;
    throw err;
  }
  const account: Account = { email: data.email, sessionToken: data.sessionToken };
  await persistAccount(account);
  return account;
}

/** The signed-in account on this device, or null. */
export async function loadAccount(): Promise<Account | null> {
  if (Platform.OS === 'web' || !SecureStore) {
    const raw = await AsyncStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    try {
      const a = JSON.parse(raw);
      if (a && typeof a.email === 'string' && typeof a.sessionToken === 'string') return a;
    } catch {
      /* unreadable — treat as signed out */
    }
    return null;
  }
  const sessionToken = await SecureStore.getItemAsync(SESSION_TOKEN_KEY).catch(() => null);
  const email = await AsyncStorage.getItem(ACCOUNT_EMAIL_KEY);
  if (sessionToken && email) return { email, sessionToken };
  return null;
}

/** Sign out on this device, and best-effort revoke the session server-side. */
export async function logoutAccount(): Promise<void> {
  const acct = await loadAccount();
  await clearAccountStore();
  if (acct) {
    fetch(`${PRINT_API}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${acct.sessionToken}` },
    }).catch(() => {});
  }
}

/**
 * Fetch the account's synced printed-order records. Returns null when signed
 * out or when the session has expired — in the expired case the stale session
 * is cleared, so the app falls back to signed-out rather than retrying a dead
 * token on every load.
 */
export async function fetchAccountOrders(): Promise<SyncedOrder[] | null> {
  const acct = await loadAccount();
  if (!acct) return null;
  let res: Response;
  try {
    res = await fetch(`${PRINT_API}/account/orders`, {
      headers: { Authorization: `Bearer ${acct.sessionToken}` },
    });
  } catch {
    return null; // offline — keep the session, just no sync this time
  }
  if (res.status === 401) {
    await clearAccountStore();
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return null;
  return Array.isArray(data.orders) ? data.orders : [];
}

/** On web, the login token the emailed link lands on (`/?login=...`). */
export function peekLoginToken(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('login');
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
