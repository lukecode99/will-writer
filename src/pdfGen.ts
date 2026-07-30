import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { WillData, Beneficiary } from './types';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 65;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.4, 0.4, 0.4);

interface DrawCtx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

function newPage(ctx: DrawCtx): DrawCtx {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  return { ...ctx, page, y: PAGE_H - MARGIN };
}

function ensureSpace(ctx: DrawCtx, needed: number): DrawCtx {
  if (ctx.y - needed < MARGIN + 20) return newPage(ctx);
  return ctx;
}

// The standard PDF fonts are WinAnsi-encoded and pdf-lib throws on any character
// outside that repertoire — including the newline you get by pressing Enter in a
// multiline address or funeral-wishes box, and any emoji. One such character
// anywhere in the will used to abort the entire PDF, so every string is
// sanitised before it reaches the page.
const CHAR_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/\r\n?/g, '\n'],
  [/\t/g, ' '],
  [/[‘’‛]/g, "'"],
  [/[“”‟]/g, '"'],
  [/[‐‑]/g, '-'],
  [/…/g, '...'],
  [/ /g, ' '],
];

// WinAnsi covers Latin-1 plus a handful of typographic extras in 0x80-0x9F.
const WINANSI_EXTRAS =
  '€‚ƒ„†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ';
const UNENCODABLE = new RegExp(`[^\\n -~\\u00A1-\\u00FF${WINANSI_EXTRAS}]`, 'g');

export function sanitizeForPdf(text: unknown): string {
  let out = String(text ?? '');
  for (const [pattern, replacement] of CHAR_SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return out.replace(UNENCODABLE, '');
}

/**
 * An unfilled field must be visible in the document, never silently absent.
 *
 * A missing name used to render as nothing at all — "I give  to  free of
 * inheritance tax, absolutely." — which still reads as finished prose and is
 * easy to sign without noticing. Every user-supplied value that reaches the
 * page goes through here, so a blank shows up as an obvious bracketed marker.
 */
function field(value: unknown, marker: string): string {
  const s = sanitizeForPdf(value).trim();
  return s === '' ? `[${marker.toUpperCase()}]` : s;
}

/**
 * A share as it should read in the document: "40%" when entered, an explicit
 * marker when not. Never print a bare "%" or a value that isn't a number —
 * free text used to reach the page as "half%".
 */
function pctLabel(raw: unknown): string {
  const s = sanitizeForPdf(raw).trim();
  const n = parseFloat(s);
  if (s === '' || isNaN(n)) return '[SHARE NOT SPECIFIED]';
  return `${s}%`;
}

/**
 * Gift labels run a), b), ... z), then aa), ab), ... — `String.fromCharCode(97 + i)`
 * alone ran off the end of the alphabet and lettered the 27th gift "{".
 */
function giftLetter(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function wrapParagraph(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// A user's line breaks are kept as line breaks rather than being flattened into
// the wrapped text, so a multiline address still reads as an address.
function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  return sanitizeForPdf(text)
    .split('\n')
    .flatMap(paragraph => (paragraph.trim() ? wrapParagraph(paragraph, font, size, maxW) : ['']));
}

// Addresses are entered in a multiline box, so they arrive with line breaks.
// Those read correctly as a standalone block, but a clause reading "I, X, of 22
// Castleton Road / Ruislip / HA4 9QJ, hereby revoke..." does not — mid-sentence
// they become commas.
function inlineAddress(address: string): string {
  return sanitizeForPdf(address)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(', ');
}

function drawText(
  ctx: DrawCtx,
  text: string,
  opts: {
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    lineGap?: number;
    center?: boolean;
  } = {}
): DrawCtx {
  const {
    size = 11,
    font,
    color = BLACK,
    indent = 0,
    lineGap = 4,
    center = false,
  } = opts;
  const f = font || ctx.regular;
  const maxW = CONTENT_W - indent;
  const lines = wrapText(text, f, size, maxW);
  let c = ctx;
  for (const line of lines) {
    c = ensureSpace(c, size + lineGap);
    const x = center
      ? MARGIN + (CONTENT_W - f.widthOfTextAtSize(line, size)) / 2
      : MARGIN + indent;
    c.page.drawText(line, { x, y: c.y, size, font: f, color });
    c = { ...c, y: c.y - size - lineGap };
  }
  return c;
}

function gap(ctx: DrawCtx, pts: number): DrawCtx {
  return ensureSpace({ ...ctx, y: ctx.y - pts }, 0);
}

function rule(ctx: DrawCtx): DrawCtx {
  const c = ensureSpace(ctx, 12);
  c.page.drawLine({
    start: { x: MARGIN, y: c.y },
    end: { x: PAGE_W - MARGIN, y: c.y },
    thickness: 0.5,
    color: GRAY,
  });
  return { ...c, y: c.y - 8 };
}

function sigBlock(ctx: DrawCtx, label: string, fields: string[]): DrawCtx {
  let c = ensureSpace(ctx, 80);
  c = drawText(c, label, { font: c.bold, size: 10 });
  c = gap(c, 4);
  for (const f of fields) {
    c = ensureSpace(c, 28);
    c = drawText(c, `${f}:`, { size: 9, color: GRAY });
    c.page.drawLine({
      start: { x: MARGIN, y: c.y },
      end: { x: PAGE_W - MARGIN, y: c.y },
      thickness: 0.5,
      color: GRAY,
    });
    c = { ...c, y: c.y - 18 };
  }
  return gap(c, 8);
}

function substitutionClause(b: Beneficiary): string {
  const pct = pctLabel(b.percentage);
  const sub = b.substitution || { type: 'per-stirpes', namedPerson: '' };
  const name = field(b.name, 'beneficiary name missing');
  const namePoss = `${name}'s`;

  if (sub.type === 'per-stirpes') {
    return (
      `If ${name} (${pct}) shall fail to survive me by 30 days, ${namePoss} share shall pass ` +
      `in equal shares to ${namePoss} children then living; if any such child has predeceased ${name} ` +
      `leaving children of their own, those grandchildren shall take their parent's share equally ` +
      `(per stirpes); and if ${name} leaves no children or issue surviving me, ${namePoss} share shall ` +
      `be divided among the other surviving residuary beneficiaries in proportion to their respective shares.`
    );
  }

  if (sub.type === 'named') {
    const named = field(sub.namedPerson, 'substitute name missing');
    return (
      `If ${name} (${pct}) shall fail to survive me by 30 days, ${namePoss} share shall pass ` +
      `to ${named} absolutely.`
    );
  }

  // pro-rata. The operative words do the work; a worked example based on the
  // current shares was dropped — it duplicated the provision in looser language
  // and had no place in the operative part of a will.
  return (
    `If ${name} (${pct}) shall fail to survive me by 30 days, ${namePoss} share shall be ` +
    `divided among the other surviving residuary beneficiaries in proportion to their respective shares.`
  );
}

export async function generateWillPdf(data: WillData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let ctx: DrawCtx = { doc, page, y: PAGE_H - MARGIN, regular, bold, italic };

  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // ── Title ──────────────────────────────────────────────────────────────────
  ctx = gap(ctx, 20);
  ctx = drawText(ctx, 'LAST WILL AND TESTAMENT', { font: bold, size: 16, center: true });
  ctx = gap(ctx, 6);
  ctx = drawText(ctx, `of ${field(data.fullName, 'full name missing')}`, { font: italic, size: 13, center: true });
  ctx = drawText(ctx, field(data.address, 'address missing'), { size: 10, color: GRAY, center: true });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx, `Made this day: ${today}`, { size: 10, color: GRAY, center: true });
  ctx = gap(ctx, 16);
  ctx = rule(ctx);
  ctx = gap(ctx, 6);

  // ── Revocation ─────────────────────────────────────────────────────────────
  ctx = drawText(ctx, 'REVOCATION OF PRIOR WILLS', { font: bold, size: 11 });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx,
    'I, ' + field(data.fullName, 'full name missing') + ', of ' +
    field(inlineAddress(data.address), 'address missing') + ', hereby revoke all former Wills and ' +
    'codicils previously made by me and declare this to be my last Will.',
    { size: 11 });
  ctx = gap(ctx, 14);

  // ── Executors ──────────────────────────────────────────────────────────────
  ctx = drawText(ctx, '1. APPOINTMENT OF EXECUTORS', { font: bold, size: 11 });
  ctx = gap(ctx, 4);

  const exec1 = data.primaryExecutor;
  const exec2 = data.secondaryExecutor;
  const backupExec = data.backupExecutor;

  ctx = drawText(ctx,
    `I appoint ${field(exec1.name, 'primary executor name missing')}` +
    `${exec1.address.trim() ? ' of ' + inlineAddress(exec1.address) : ''} ` +
    `to be the Executor of this my Will.`,
    { size: 11 });

  if (exec2.name.trim()) {
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `I also appoint ${sanitizeForPdf(exec2.name).trim()}` +
      `${exec2.address.trim() ? ' of ' + inlineAddress(exec2.address) : ''} ` +
      `to be Executor jointly with or as a substitute for the above.`,
      { size: 11 });
  }

  if (backupExec.name.trim()) {
    ctx = gap(ctx, 4);
    // "neither of the foregoing Executors" only reads correctly when two have
    // actually been appointed; with one named executor it referred to a person
    // who isn't in the document.
    const foregoing = exec2.name.trim()
      ? 'neither of the foregoing Executors is'
      : 'the foregoing Executor is not';
    ctx = drawText(ctx,
      `In the event that ${foregoing} able or willing to act, ` +
      `I appoint ${sanitizeForPdf(backupExec.name).trim()}` +
      `${backupExec.address.trim() ? ' of ' + inlineAddress(backupExec.address) : ''} as substitute Executor.`,
      { size: 11 });
  }

  ctx = gap(ctx, 14);

  // ── Guardians ──────────────────────────────────────────────────────────────
  if (data.guardians.length > 0) {
    ctx = drawText(ctx, '2. APPOINTMENT OF GUARDIANS', { font: bold, size: 11 });
    ctx = gap(ctx, 4);
    const gNames = data.guardians
      .map(g => field(g.name, 'guardian name missing') + (g.address.trim() ? ' of ' + inlineAddress(g.address) : ''))
      .join(' and ');
    ctx = drawText(ctx,
      `In the event of my death while any of my children are under the age of 18 years, ` +
      `I appoint ${gNames} to be the guardian(s) of my minor children.`,
      { size: 11 });
    ctx = gap(ctx, 14);
  }

  // ── Specific Gifts ─────────────────────────────────────────────────────────
  const clauseNum = data.guardians.length > 0 ? 3 : 2;

  if (data.specificGifts.length > 0) {
    ctx = drawText(ctx, `${clauseNum}. SPECIFIC GIFTS`, { font: bold, size: 11 });
    ctx = gap(ctx, 4);

    for (let i = 0; i < data.specificGifts.length; i++) {
      const gift = data.specificGifts[i];
      const letter = giftLetter(i);
      const description = field(gift.description, 'gift not described');
      const recipient = field(gift.recipient, 'recipient name missing');

      let giftClause: string;
      if (gift.isCharity) {
        // A gift to a UK registered charity is exempt (IHTA 1984 s.23), so there
        // is no attributable tax to allocate either way.
        giftClause =
          `${letter}) I give ${description} to ${recipient} ` +
          `(a registered charity) to be applied for its general purposes, and the receipt of its ` +
          `treasurer or other proper officer shall be a full discharge to my Executors.`;
      } else if (gift.taxBurden === 'freeOfTax') {
        giftClause =
          `${letter}) I give ${description} to ${recipient} ` +
          `free of inheritance tax, absolutely.`;
      } else {
        // Default. Older drafts saved before this choice existed have no
        // taxBurden at all, and fall here — the option that leaves residue intact.
        giftClause =
          `${letter}) I give ${description} to ${recipient} absolutely, ` +
          `subject to the inheritance tax attributable to this gift.`;
      }

      // Substitution clause for the gift. Choosing "passes to someone else" and
      // then leaving the name blank used to fall through to the residue wording
      // with nothing on the page to show it — silently changing who inherits.
      // A charity does not "fail to survive me by 30 days" — it ceases to exist
      // or amalgamates, so the trigger has to be worded for the right kind of
      // recipient or the clause never bites.
      const failTrigger = gift.isCharity
        ? `If ${recipient} shall have ceased to exist or amalgamated with another charity at my death`
        : `If ${recipient} shall fail to survive me by 30 days`;

      let failClause: string;
      if (gift.substitutionType === 'named') {
        failClause =
          `${failTrigger}, this gift shall pass to ` +
          `${field(gift.substitutionRecipient, 'alternative recipient name missing')} absolutely.`;
      } else {
        failClause = `${failTrigger}, this gift shall fall into and form part of my residuary estate.`;
      }

      ctx = drawText(ctx, giftClause, { size: 11 });
      ctx = gap(ctx, 2);
      ctx = drawText(ctx, `   ${failClause}`, { size: 11, indent: 16 });
      ctx = gap(ctx, 6);
    }
    ctx = gap(ctx, 8);
  }

  // ── Burden of inheritance tax ──────────────────────────────────────────────
  // Only meaningful once there is a specific gift to allocate tax between. The
  // default rule (IHTA 1984 s.211) already sends tax on UK free-estate property
  // to residue as a testamentary expense, but it is silent on gifts the testator
  // wants the recipient to bear, and it says nothing about what happens when
  // residue cannot carry the charge. Both are spelled out here.
  const ihtNum = clauseNum + 1;
  const hasGifts = data.specificGifts.length > 0;

  if (hasGifts) {
    const chargeableGifts = data.specificGifts.filter(g => !g.isCharity);
    const anyFreeOfTax = chargeableGifts.some(g => g.taxBurden === 'freeOfTax');

    ctx = drawText(ctx, `${ihtNum}. BURDEN OF INHERITANCE TAX`, { font: bold, size: 11 });
    ctx = gap(ctx, 4);

    if (!anyFreeOfTax) {
      // Nothing was given free of tax, so there is no allocation to describe —
      // saying otherwise would leave a limb of the clause pointing at no gift.
      ctx = drawText(ctx,
        `Each specific gift made by this Will shall bear its own inheritance tax, and my Executors shall ` +
        `be entitled to recover or retain that tax out of the property comprised in the gift. All other ` +
        `inheritance tax and other taxes and duties payable on or by reason of my death in respect of ` +
        `property passing under this Will shall be borne by my residuary estate as a testamentary expense.`,
        { size: 11 });
    } else {
      ctx = drawText(ctx,
        `All inheritance tax and other taxes and duties payable on or by reason of my death in respect of ` +
        `property passing under this Will shall be borne as follows:`,
        { size: 11 });
      ctx = gap(ctx, 6);
      ctx = drawText(ctx,
        `(a) Any gift expressed above to be free of inheritance tax shall be paid free of such tax, and the ` +
        `tax attributable to it shall be borne by my residuary estate as a testamentary expense.`,
        { size: 11, indent: 16 });
      ctx = gap(ctx, 4);
      ctx = drawText(ctx,
        `(b) Any other gift shall bear its own inheritance tax, and my Executors shall be entitled to ` +
        `recover or retain that tax out of the property comprised in the gift.`,
        { size: 11, indent: 16 });
      ctx = gap(ctx, 4);
      ctx = drawText(ctx,
        `(c) If my residuary estate is insufficient to bear the inheritance tax on the gifts given free of ` +
        `tax, those gifts shall abate rateably between them to the extent necessary to discharge that tax.`,
        { size: 11, indent: 16 });
    }

    ctx = gap(ctx, 14);
  }

  // ── Residuary ──────────────────────────────────────────────────────────────
  const resNum = clauseNum + (hasGifts ? 2 : 0);
  ctx = drawText(ctx, `${resNum}. RESIDUARY ESTATE`, { font: bold, size: 11 });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx,
    `I give all my real and personal estate (including any property over which I have a power of appointment) ` +
    `not otherwise disposed of by this Will, after payment of all my debts, funeral and testamentary expenses, ` +
    `to the following beneficiaries in the proportions stated:`,
    { size: 11 });
  ctx = gap(ctx, 6);

  for (const b of data.beneficiaries) {
    ctx = drawText(ctx,
      `• ${field(b.name, 'beneficiary name missing')}` +
      `${b.relationship.trim() ? ' (' + sanitizeForPdf(b.relationship).trim() + ')' : ''} — ${pctLabel(b.percentage)}` +
      `${b.isMinor ? ' (held on trust until age 18)' : ''}`,
      { size: 11, indent: 16 });
  }

  ctx = gap(ctx, 10);

  // ── Survivorship (always emitted) ──────────────────────────────────────────
  ctx = drawText(ctx, 'SURVIVORSHIP AND SUBSTITUTION', { font: bold, size: 10 });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx,
    `Each beneficiary must survive me by 30 days to benefit under this clause. ` +
    `In the event that any beneficiary fails so to survive me:`,
    { size: 11 });
  ctx = gap(ctx, 6);

  for (let i = 0; i < data.beneficiaries.length; i++) {
    const b = data.beneficiaries[i];
    ctx = drawText(ctx,
      `(${giftLetter(i)}) ${substitutionClause(b)}`,
      { size: 11, indent: 16 });
    ctx = gap(ctx, 6);
  }

  // ── Ultimate backstop ─────────────────────────────────────────────────────
  ctx = gap(ctx, 4);
  if (data.ultimateBackstop.trim()) {
    ctx = drawText(ctx,
      `If no residuary beneficiary or their substituted beneficiary shall survive me by 30 days, ` +
      `my residuary estate shall pass to ${sanitizeForPdf(data.ultimateBackstop).trim()} absolutely.`,
      { size: 11 });
  } else {
    ctx = drawText(ctx,
      `If no residuary beneficiary or their substituted beneficiary shall survive me by 30 days, ` +
      `my residuary estate shall pass in accordance with the laws of intestacy as if I had died without a Will.`,
      { size: 11 });
  }

  // ── Trusts for minor beneficiaries ────────────────────────────────────────
  const minorBens = data.beneficiaries.filter(b => b.isMinor);
  if (minorBens.length > 0) {
    ctx = gap(ctx, 10);
    ctx = drawText(ctx, 'TRUSTS FOR MINOR BENEFICIARIES', { font: bold, size: 10 });
    ctx = gap(ctx, 4);
    const minorNames = minorBens.map(b => field(b.name, 'beneficiary name missing')).join(' and ');
    ctx = drawText(ctx,
      `Any share of my residuary estate passing to a beneficiary (including ${minorNames}) who has not ` +
      `attained the age of 18 years at the date of my death shall be held by my Executors as trustees on ` +
      `the following trusts:`,
      { size: 11 });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `(a) The share shall be retained and held until such beneficiary attains the age of 18 years or ` +
      `dies before that age.`,
      { size: 11, indent: 16 });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `(b) During the period of the trust, my Executors shall have full power to apply any income or ` +
      `capital of the share for the maintenance, education or benefit of such beneficiary.`,
      { size: 11, indent: 16 });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `(c) On attaining the age of 18 years, the capital and any accumulated income shall be paid or ` +
      `transferred to such beneficiary absolutely.`,
      { size: 11, indent: 16 });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `(d) If such beneficiary dies before attaining the age of 18, their share shall pass in accordance ` +
      `with the substitution provisions set out above.`,
      { size: 11, indent: 16 });
  }

  ctx = gap(ctx, 14);

  // ── Funeral Wishes ─────────────────────────────────────────────────────────
  // The body is assembled before anything is drawn so the section can be
  // dropped whole when there is nothing to say. Guarding on
  // `funeralWishes || burialPreference` was not enough: "No preference" stores
  // the truthy 'noPreference', which draws no body line, so the heading and the
  // "I express the following wishes..." preamble printed with nothing under
  // them. Whitespace-only free text did the same.
  const funeralNum = resNum + 1;
  const funeralLines: string[] = [];

  if (data.burialPreference === 'burial') {
    funeralLines.push('I wish to be buried.');
  } else if (data.burialPreference === 'cremation') {
    funeralLines.push('I wish to be cremated.');
  } else if (data.burialPreference === 'noPreference') {
    // An explicit "no preference" is itself a wish worth recording — it tells
    // the executors the choice is theirs rather than leaving them guessing.
    funeralLines.push('I have no preference as to burial or cremation, and leave that decision to my Executors.');
  }

  const freeTextWishes = sanitizeForPdf(data.funeralWishes).trim();
  if (freeTextWishes) funeralLines.push(freeTextWishes);

  if (funeralLines.length > 0) {
    ctx = drawText(ctx, `${funeralNum}. FUNERAL WISHES`, { font: bold, size: 11 });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `I express the following wishes regarding my funeral (without imposing any legal obligation on my Executors):`,
      { size: 11 });
    ctx = gap(ctx, 4);

    for (const line of funeralLines) {
      ctx = drawText(ctx, line, { size: 11, indent: 16 });
    }
    ctx = gap(ctx, 14);
  }

  // ── Attestation ────────────────────────────────────────────────────────────
  ctx = ensureSpace(ctx, 220);
  ctx = rule(ctx);
  ctx = gap(ctx, 6);
  ctx = drawText(ctx, 'ATTESTATION', { font: bold, size: 12, center: true });
  ctx = gap(ctx, 8);
  ctx = drawText(ctx,
    `SIGNED by the above-named Testator as their last Will in our presence and then by us in the presence of ` +
    `the Testator and of each other:`,
    { size: 11 });
  ctx = gap(ctx, 16);

  ctx = sigBlock(ctx, 'TESTATOR', ['Signature', 'Date']);
  ctx = gap(ctx, 12);
  ctx = sigBlock(ctx, 'WITNESS 1 (must not be a beneficiary or spouse of a beneficiary)', [
    'Signature', 'Full name', 'Address', 'Occupation',
  ]);
  ctx = gap(ctx, 12);
  ctx = sigBlock(ctx, 'WITNESS 2 (must not be a beneficiary or spouse of a beneficiary)', [
    'Signature', 'Full name', 'Address', 'Occupation',
  ]);

  // ── Signing Instructions (new page) ────────────────────────────────────────
  ctx = newPage(ctx);
  ctx = gap(ctx, 20);
  ctx = drawText(ctx, 'SIGNING INSTRUCTIONS', { font: bold, size: 14, center: true });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx, 'Please read these instructions carefully before signing your Will.', {
    size: 11, center: true, color: GRAY,
  });
  ctx = gap(ctx, 16);

  const instructions: [string, string][] = [
    ['1. Arrange to sign in person',
     'You must sign your Will in the physical presence of BOTH witnesses at the same time.'],
    ['2. Choose your witnesses carefully',
     'Witnesses must be adults (aged 18 or over). A witness (or the spouse or civil partner of a witness) ' +
     'must NOT be a beneficiary under the Will — any gift to them will be void.'],
    ['3. Do not sign early',
     'Do not sign the Will before both witnesses are present and watching.'],
    ['4. Witness signature',
     'After you have signed, each witness must sign the Will in your presence and in the presence of the other witness, ' +
     'on the same occasion. Both witnesses must write their full names, addresses and occupations.'],
    ['5. No alterations after signing',
     'Once signed and witnessed, do not alter the Will. Any amendment must be done by a new codicil or a fresh Will.'],
    ['6. Store safely',
     'Keep the original Will in a safe place — a solicitor\'s safe, a bank, or the Probate Registry. ' +
     'Tell your Executors where to find it.'],
  ];

  for (const [title, body] of instructions) {
    ctx = drawText(ctx, title, { font: bold, size: 11 });
    ctx = gap(ctx, 2);
    ctx = drawText(ctx, body, { size: 11 });
    ctx = gap(ctx, 10);
  }

  // ── Disclaimer (new page) ──────────────────────────────────────────────────
  ctx = newPage(ctx);
  ctx = gap(ctx, 20);
  ctx = drawText(ctx, 'IMPORTANT NOTICE', { font: bold, size: 13, center: true });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx, 'THIS IS A TEMPLATE DOCUMENT — NOT LEGAL ADVICE', {
    font: bold, size: 11, center: true, color: rgb(0.7, 0.1, 0.1),
  });
  ctx = gap(ctx, 14);
  const disclaimers = [
    'This document was generated by Will Writer, a self-service template tool. It does not constitute legal advice and no solicitor-client relationship is created by its use.',
    'Will Writer templates are designed for straightforward England & Wales estates. They may NOT be suitable if you: own property abroad; have a business interest; have children from a previous relationship; have an estate that may be liable to Inheritance Tax; have concerns about a beneficiary\'s ability to manage money; or have complex family circumstances.',
    'For peace of mind and certainty, we strongly recommend that this document is reviewed by a qualified solicitor before signing.',
    'Will Writer, its operators and affiliates accept no liability for any loss arising from reliance on this document.',
  ];
  for (const d of disclaimers) {
    ctx = drawText(ctx, d, { size: 10 });
    ctx = gap(ctx, 8);
  }

  return doc.save();
}
