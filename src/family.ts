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

/**
 * Puts the slashes in a date as it is typed, so `24071986` becomes
 * `24/07/1986` without anyone reaching for the punctuation key.
 *
 * The parser above is strict — an unseparated `24071986` is not a date and
 * never was — so the separators had to come from somewhere, and typing them on
 * a phone keypad means switching layouts twice per date. Two dates in and it is
 * the most irritating part of the form.
 *
 * Two rules, and the interesting one is the second.
 *
 * Digits fill day, month and year in turn and roll over when a part is full, so
 * eight straight digits land correctly. But a slash the user types themselves
 * also ends the current part, which is what keeps `1/6/2004` working: the day
 * is one digit because they said it was. Rolling purely on length would read
 * that as `16/20/04` — a valid-looking date, in a field where wrong-but-plausible
 * is the only outcome worth fearing.
 *
 * Nothing is ever padded and no trailing slash is ever added. Both would fight
 * the backspace key: a slash re-appearing as fast as it is deleted is a field
 * you cannot get out of, and it is the one behaviour people notice immediately.
 * A slash is only ever shown once there is something on the far side of it.
 *
 * Editing in the middle of a completed date can send the cursor to the end,
 * because the value is controlled and reformatting changes the string. Left
 * alone: eight characters is a field people retype rather than repair, and the
 * alternative is tracking selection state through every keystroke.
 */
export function formatUkDateInput(raw: string): string {
  const typed = (raw || '').replace(/[^\d/]/g, '');
  const limits = [2, 2, 4];
  const parts = ['', '', ''];
  let at = 0;

  for (const ch of typed) {
    if (ch === '/') {
      // Only ends a part that has something in it, so a stray or doubled slash
      // cannot push the year into the day's place.
      if (at < 2 && parts[at].length > 0) at++;
      continue;
    }
    if (parts[at].length === limits[at] && at < 2) at++;
    if (parts[at].length < limits[at]) parts[at] += ch;
  }

  const out: string[] = [];
  for (const part of parts) {
    if (part === '') break;
    out.push(part);
  }
  return out.join('/');
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

/**
 * The list of children read back to the user for confirmation.
 *
 * It names them rather than counting them. "You have listed 2 children" is
 * agreed with by reflex; "Oliver Smith, Amelia Smith" is the only form that can
 * be compared against the family someone actually has, and the whole purpose of
 * the question is to make that comparison happen once.
 *
 * A child added but not yet named is shown as unnamed rather than dropped —
 * a blank row is exactly the state where someone is halfway through and should
 * not be confirming anything.
 */
export function childrenSummary(children: { name: string }[]): string {
  if (children.length === 0) return 'You have not listed any children.';
  const names = children.map(c => c.name.trim() || 'a child with no name yet');
  const listed = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return names.length === 1
    ? `You have listed one child: ${listed}.`
    : `You have listed ${names.length} children: ${listed}.`;
}
