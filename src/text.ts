/**
 * Text preparation for the PDF, kept separate from `pdfGen` so that the screens
 * can ask "will this print?" without pulling pdf-lib into their bundle.
 *
 * The standard PDF fonts are WinAnsi-encoded and pdf-lib throws on any character
 * outside that repertoire — including the newline you get by pressing Enter in a
 * multiline address, and any emoji. One such character anywhere in the will used
 * to abort the entire PDF, so every string is sanitised before it reaches the
 * page.
 *
 * The first version of this simply deleted anything unencodable. That turned
 * "Michał Łukasz" into "Micha ukasz" in the operative words of a signed will,
 * and a wholly non-Latin name into an empty string, which then rendered as
 * "[BENEFICIARY NAME MISSING]" — blaming the user for data they had entered
 * correctly. Deleting characters out of a legal name is not an acceptable
 * failure mode, so now: transliterate what has a faithful Latin form, and
 * report what does not so the caller can refuse to generate rather than print
 * a name that is wrong.
 */

// Typographic characters that have an exact plain-text equivalent. Applied
// before the encodability pass, so they never reach the transliterator.
const CHAR_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/\r\n?/g, '\n'],
  [/\t/g, ' '],
  // U+02BC is included because some keyboards emit it for an apostrophe; it is
  // not in the U+2018 block and was previously deleted out of "O’Brien".
  [/[‘’‛ʼ′]/g, "'"],
  [/[“”‟″]/g, '"'],
  [/[‐‑‒−]/g, '-'],
  [/…/g, '...'],
  // Non-breaking and typographic spaces, including the ones iOS inserts.
  [/[       ]/g, ' '],
  // Zero-width characters carry no information and are invisible on screen, so
  // dropping them silently is safe — unlike dropping a letter.
  [/[​‌‍﻿]/g, ''],
];

// WinAnsi covers Latin-1 plus a handful of typographic extras in 0x80-0x9F.
const WINANSI_EXTRAS =
  '€‚ƒ„†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ';

const ENCODABLE_ONE = new RegExp(`^[\\n -~\\u00A0-\\u00FF${WINANSI_EXTRAS}]$`);

/**
 * Transliterations grouped by target, so a letter cannot be silently misaligned
 * with the wrong replacement the way two parallel strings can.
 *
 * Only consulted for characters WinAnsi cannot encode: Š, Ž, Œ, Æ, Ø, ß, Þ and
 * the accented Western European letters are all encodable and pass through
 * untouched, which is why "Þór", "Ægir" and "Müller" are unaffected.
 */
const TRANSLIT_GROUPS: Array<[string, string]> = [
  ['A', 'ĀĂĄǍȦẠẢẤẦẨẪẬẮẰẲẴẶ'], ['a', 'āăąǎȧạảấầẩẫậắằẳẵặ'],
  ['C', 'ĆĈĊČ'], ['c', 'ćĉċč'],
  ['D', 'ĎĐ'], ['d', 'ďđ'],
  ['E', 'ĒĔĖĘĚƏẸẺẼẾỀỂỄỆ'], ['e', 'ēĕėęěəẹẻẽếềểễệ'],
  ['G', 'ĜĞĠĢǴ'], ['g', 'ĝğġģǵ'],
  ['H', 'ĤĦḤ'], ['h', 'ĥħḥ'],
  ['I', 'ĨĪĬĮİǏỊỈ'], ['i', 'ĩīĭįıǐịỉ'],
  ['J', 'Ĵ'], ['j', 'ĵ'],
  ['K', 'ĶḲ'], ['k', 'ķĸḳ'],
  ['L', 'ĹĻĽĿŁḶ'], ['l', 'ĺļľŀłḷ'],
  ['N', 'ŃŅŇŊǸṆ'], ['n', 'ńņňŉŋǹṇ'],
  ['O', 'ŌŎŐƠǑỌỎỐỒỔỖỘỚỜỞỠỢ'], ['o', 'ōŏőơǒọỏốồổỗộớờởỡợ'],
  ['R', 'ŔŖŘṚ'], ['r', 'ŕŗřṛ'],
  ['S', 'ŚŜŞȘṢ'], ['s', 'śŝşșṣſ'],
  ['T', 'ŢŤŦȚṬ'], ['t', 'ţťŧțṭ'],
  ['U', 'ŨŪŬŮŰŲƯǓỤỦỨỪỬỮỰ'], ['u', 'ũūŭůűųưǔụủứừửữự'],
  ['W', 'ŴẂẀ'], ['w', 'ŵẃẁ'],
  ['Y', 'ŶỲỴỶỸ'], ['y', 'ŷỳỵỷỹ'],
  ['Z', 'ŹŻẒ'], ['z', 'źżẓ'],
  ['IJ', 'Ĳ'], ['ij', 'ĳ'],
  ['DZ', 'ǄǱ'], ['Dz', 'ǅǲ'], ['dz', 'ǆǳ'],
  ['LJ', 'Ǉ'], ['Lj', 'ǈ'], ['lj', 'ǉ'],
  ['NJ', 'Ǌ'], ['Nj', 'ǋ'], ['nj', 'ǌ'],
];

const TRANSLIT: Record<string, string> = {};
for (const [target, sources] of TRANSLIT_GROUPS) {
  for (const ch of sources) TRANSLIT[ch] = target;
}

// Combining marks, listed as explicit ranges rather than \p{M}. Unicode
// property escapes are not guaranteed across every Hermes build the app might
// run on, and a name in a will is the last place to find out.
const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

/**
 * Last-resort decomposition for accented letters not in the table above:
 * "ǣ" -> "æ", "ḗ" -> "e". Guarded because `normalize` is an optional part of
 * some minimal JS engines; when it is missing the character is reported as
 * unprintable instead, which is the safe direction.
 */
function stripMarks(ch: string): string {
  if (typeof String.prototype.normalize !== 'function') return '';
  try {
    return ch.normalize('NFD').replace(COMBINING_MARKS, '');
  } catch {
    return '';
  }
}

export interface SanitizeResult {
  text: string;
  /** Distinct characters that had no printable form and were left out. */
  dropped: string[];
}

export function sanitizeDetailed(input: unknown): SanitizeResult {
  let staged = String(input ?? '');
  for (const [pattern, replacement] of CHAR_SUBSTITUTIONS) {
    staged = staged.replace(pattern, replacement);
  }

  const dropped: string[] = [];
  let out = '';

  // for..of iterates by code point, so an emoji is seen as one character rather
  // than as two lone surrogates.
  for (const ch of staged) {
    if (ENCODABLE_ONE.test(ch)) {
      out += ch;
      continue;
    }

    const mapped = TRANSLIT[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }

    const decomposed = stripMarks(ch);
    if (decomposed && Array.from(decomposed).every(c => ENCODABLE_ONE.test(c))) {
      out += decomposed;
      continue;
    }

    if (dropped.indexOf(ch) === -1) dropped.push(ch);
  }

  return { text: out, dropped };
}

export function sanitizeForPdf(text: unknown): string {
  return sanitizeDetailed(text).text;
}

/**
 * The characters in `text` that cannot be printed at all. A non-empty result on
 * a name is a reason to refuse to generate: the alternative is a will that
 * identifies somebody who does not exist.
 */
export function unprintableChars(text: unknown): string[] {
  return sanitizeDetailed(text).dropped;
}
