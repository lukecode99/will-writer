import { WillData } from './types';

/**
 * Date handling for the two places a date decides something: whether the
 * guardians step is shown, and whether the testator is old enough to make a
 * will at all (Wills Act 1837 s.7 — a will made under 18 is invalid).
 *
 * Everything is done at UTC midnight. A birthday is a calendar date, not an
 * instant, and mixing a UTC-constructed date of birth with a local "now" put
 * the boundary cases a day out depending on the device's timezone.
 */

export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Strict DD/MM/YYYY. Returns null for anything else, including dates that do
 * not exist: `new Date(2020, 1, 31)` silently rolls "31/02/2020" forward to
 * 2 March, so the round-trip is checked rather than trusted.
 */
export function parseUkDate(raw: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((raw || '').trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Completed years between `dob` and `on`, by calendar date rather than by a 365.25 approximation. */
export function ageInYears(dob: Date, on: Date = todayUtc()): number {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** A date of birth that is in the future, or absurdly far back, is a typo rather than a fact. */
export function dobError(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 'Date of birth is required.';
  const date = parseUkDate(trimmed);
  if (!date) return 'Enter the date as DD/MM/YYYY, for example 09/03/1986.';
  const today = todayUtc();
  if (date.getTime() > today.getTime()) return 'That date is in the future.';
  if (ageInYears(date, today) > 120) return 'Please check the year.';
  return '';
}

/**
 * Whether any child is, or might be, under 18.
 *
 * Deliberately fails open: a missing or unparseable date of birth counts as a
 * minor, so a half-typed date can never make the guardians step disappear.
 */
export function hasMinorChildren(data: WillData): boolean {
  if (data.children.length === 0) return false;
  const today = todayUtc();
  return data.children.some(child => {
    const dob = parseUkDate(child.dob);
    if (!dob) return true;
    return ageInYears(dob, today) < 18;
  });
}

/** Formats a date of birth for the document. Returns '' when it cannot be trusted. */
export function formatDobLong(raw: string): string {
  const date = parseUkDate(raw);
  if (!date) return '';
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
