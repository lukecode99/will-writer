import { PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFPage } from 'pdf-lib';
import { WillData, Beneficiary } from './types';
import { sanitizeForPdf } from './text';
import { formatDobLong, parseUkDate, ageInYears } from './family';
import { blockingProblems, parsePercentage, formatPercentage, WillProblem } from './validation';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 65;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.7, 0.1, 0.1);

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

/**
 * An unfilled field must be visible in the document, never silently absent.
 *
 * A missing name used to render as nothing at all — "I give  to  free of
 * inheritance tax, absolutely." — which still reads as finished prose and is
 * easy to sign without noticing. Every user-supplied value that reaches the
 * page goes through here, so a blank shows up as an obvious bracketed marker.
 *
 * Markers should now only ever appear in a draft: `generateWillPdf` refuses to
 * produce a final document while `blockingProblems` is non-empty. They stay
 * because a marker is the correct thing to print if a gap ever gets past the
 * gate, and because the draft preview relies on them.
 */
function field(value: unknown, marker: string): string {
  const s = sanitizeForPdf(value).trim();
  return s === '' ? `[${marker.toUpperCase()}]` : s;
}

/**
 * A share as it should read in the document.
 *
 * This used to print the raw string rather than the parsed number, and relied on
 * `parseFloat`, which reads a valid prefix and ignores the rest — so "50." went
 * into the operative words as "50.%" and "50abc" as "50abc%". Parsing is now
 * strict and shared with the on-screen validation, so what blocks the button and
 * what reaches the page can never drift apart.
 */
function pctLabel(raw: unknown): string {
  const value = parsePercentage(sanitizeForPdf(raw));
  return value === null ? '[SHARE NOT SPECIFIED]' : formatPercentage(value);
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
  // A single token wider than the column is hard-broken by characters rather
  // than drawn past the page edge. Off-page text is not clipped on screen only —
  // it is absent from the printed sheet, and in this document absent text can
  // be operative words.
  const words = text.split(' ').flatMap(word => {
    if (font.widthOfTextAtSize(word, size) <= maxW) return [word];
    const pieces: string[] = [];
    let piece = '';
    for (const ch of word) {
      if (piece && font.widthOfTextAtSize(piece + ch, size) > maxW) {
        pieces.push(piece);
        piece = ch;
      } else {
        piece += ch;
      }
    }
    if (piece) pieces.push(piece);
    return pieces;
  });
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
  // Defended rather than trusted, even though the type says both are present:
  // wills reach here from disk, and `normalizeSubstitution` is the only thing
  // between a JSON file written by some other build and this function. A missing
  // array would throw halfway through generating a document.
  const raw = b.substitution || { type: 'per-stirpes' as const, substitutes: [], namedFallback: 'survivors' as const };
  const sub = {
    type: raw.type,
    substitutes: Array.isArray(raw.substitutes) ? raw.substitutes : [],
    // Whitelisted, not trusted: anything other than the explicit new value —
    // including every draft saved before the field existed — drafts as the
    // clause always drafted, survivors first.
    namedFallback: raw.namedFallback === 'issue' ? 'issue' as const : 'survivors' as const,
  };
  const name = field(b.name, 'beneficiary name missing');
  const namePoss = `${name}'s`;

  // The event that takes this beneficiary out of the gift. A person fails to
  // survive; a charity ceases to exist or amalgamates. Writing family
  // survivorship onto an organisation produced operative words about a
  // company's "children" — wrong kind of recipient, wrong kind of failure.
  const trigger = b.isCharity
    ? `If ${name} (${pct}) shall have ceased to exist or amalgamated with another charity or body at my death`
    : `If ${name} (${pct}) shall fail to survive me by 30 days`;

  /**
   * Words disapplying Wills Act 1837 s.33, for a gift to the testator's own
   * child where the substitution chosen is not per stirpes.
   *
   * s.33 operates by default: a gift to a child of the testator who dies first
   * leaving issue passes to that issue, unless a contrary intention appears *by
   * the will*. Choosing "to a named person" or "split between the others" for
   * your own child is exactly that contrary intention — the grandchildren take
   * nothing — and until now the document said so nowhere. It recorded the
   * substitution and stayed silent on the statute it displaced, which leaves two
   * problems.
   *
   * The first is legal: whether a substitution clause displaces s.33 is a
   * question of construction, and it is one that gets argued. Saying it in terms
   * removes the argument. A will is read after the only person who could explain
   * it is dead, so anything left to inference is left to a dispute.
   *
   * The second is plainer. Someone reading their own will back should be able to
   * see that their grandchildren have been cut out of that share. The app warns
   * about it on the way through, but the will is the thing that gets printed,
   * signed and kept in a drawer for twenty years, and it was the one place that
   * did not mention it.
   *
   * Nothing is added in the per-stirpes case: the express clause and s.33 say
   * the same thing, and words put into the operative part of a will to say that
   * a provision agrees with the general law are words that can only be argued
   * over later.
   */
  const s33 = b.isOwnChild
    ? ` ${name} is my child. I direct that section 33 of the Wills Act 1837 shall not apply to this ` +
      `gift, so that ${namePoss} children shall not take ${namePoss} share in ${namePoss} place.`
    : '';

  // Both limbs are keyed to the same 30-day window as the gift itself. The old
  // words used "children then living" (then = when?) and keyed the grandchild
  // limb to predeceasing the BENEFICIARY — so a child who outlived the
  // beneficiary but died before the testator, or inside the 30 days, was in
  // neither limb and their branch silently lapsed.
  if (sub.type === 'per-stirpes') {
    return (
      `${trigger}, ${namePoss} share shall pass in equal shares to such of ${namePoss} children ` +
      `as shall survive me by 30 days; if any child of ${name} shall have died in my lifetime or ` +
      `failed to survive me by 30 days, leaving children of their own living at my death, those ` +
      `grandchildren shall take their parent's share equally between them (per stirpes); and if no ` +
      `child or issue of ${name} shall so survive me, ${namePoss} share shall be divided among the ` +
      `other surviving residuary beneficiaries in proportion to their respective shares.`
    );
  }

  /**
   * To the testator's own children, as a class.
   *
   * The class is described, not listed. "Such of my children as shall survive
   * me" picks up a child born after the will is signed; a list of names freezes
   * the family as it was on the day of signing, and the person most likely to be
   * frozen out is a child who did not exist yet. The reader who wants the names
   * has them in the declaration as to family, with dates of birth, which is the
   * clause that exists to say who the family is.
   *
   * No s.33 wording here, and none is wanted. s.33 is about a gift to a child of
   * the testator who dies first; this branch is only ever reached for a
   * beneficiary who is not the testator's child, so the section has nothing to
   * operate on. The combination is refused in `blockingProblems` rather than
   * silently drafted around, because the two provisions would contradict each
   * other in the same sentence.
   */
  if (sub.type === 'own-children') {
    // The grandchild limb keys to "died in my lifetime or failed to survive me
    // by 30 days" — not "predeceased me" — so a child who survives the testator
    // but dies inside the 30-day window still passes their share down to their
    // own children rather than having it redistribute sideways.
    return (
      `${trigger}, ${namePoss} share shall pass in equal shares to such of my children as shall ` +
      `survive me by 30 days; and if any child of mine shall have died in my lifetime or failed to ` +
      `survive me by 30 days, leaving children living at my death, those grandchildren shall take ` +
      `equally between them the share their parent would have taken (per stirpes); and if no child ` +
      `or issue of mine shall so survive me, ${namePoss} share shall be divided among the other ` +
      `surviving residuary beneficiaries in proportion to their respective shares.`
    );
  }

  /**
   * To people the testator names, in shares of this beneficiary's share.
   *
   * One substitute takes the whole share, so nothing is apportioned; a draft
   * saved under the old single-name field migrates to exactly this case.
   *
   * Two or more are apportioned with "as to N% thereof". "Thereof" is doing the
   * only job that matters in the sentence: it fixes the percentage to the share
   * being substituted and not to the estate. Without it, "50% to Jacob" sitting
   * inside a clause about a 60% share is a genuine ambiguity, and it is the one
   * a reader is most likely to resolve the wrong way.
   *
   * The cross-accruer sentence closes the hole a list opens. If one of two named
   * substitutes dies first and nothing says where their part goes, that part
   * lapses: it is not caught by the gift over to the other, because there is no
   * gift over, and it falls into partial intestacy while the rest of the will
   * works fine. Sending it to the survivors of them keeps it inside the
   * provision the testator actually made.
   *
   * Every branch then closes its own gap: if NO substitute survives, the share
   * goes to the other surviving residuary beneficiaries. The ultimate clause
   * below cannot be relied on for this — it used to be conditioned on the WHOLE
   * estate failing, so one surviving beneficiary elsewhere blocked it while
   * this branch's share fell into intestacy. Substitutes also take on the same
   * 30-day condition as every other taker in the scheme: without it, a
   * substitute who outlived the testator by a day took absolutely and the share
   * passed through the substitute's own estate.
   */
  if (sub.type === 'named') {
    const subs = sub.substitutes.length > 0
      ? sub.substitutes
      : [{ id: '', name: '', share: '', address: '' }];

    // The address rides with the FIRST mention of the name only. A will
    // identifies a person once and then refers back; repeating "of 4 Elm Road"
    // at every mention reads as if each might be a different John Smith.
    const identify = (s: { name: string; address?: string }): string =>
      field(s.name, 'substitute name missing') +
      (typeof s.address === 'string' && s.address.trim() ? ` of ${inlineAddress(s.address)}` : '');

    // The 'issue' fallback keys to "died in my lifetime or failed to survive me
    // by 30 days" — the same double-limb as the per-stirpes clauses above, and
    // for the same reason: "predecease" alone leaves a substitute who outlives
    // the testator by a week in neither limb, with their part passing through
    // their own estate instead of to their children.
    if (subs.length === 1) {
      const named = field(subs[0].name, 'substitute name missing');
      if (sub.namedFallback === 'issue') {
        return (
          `${trigger}, ${namePoss} share shall pass to ${identify(subs[0])}, provided that ${named} ` +
          `survives me by 30 days. If ${named} shall have died in my lifetime or failed to survive ` +
          `me by 30 days, leaving children living at my death, those children shall take that share ` +
          `equally between them (per stirpes); and if ${named} shall not so survive me and shall ` +
          `leave no such children, that share shall be divided among the other surviving residuary ` +
          `beneficiaries in proportion to their respective shares.${s33}`
        );
      }
      return (
        `${trigger}, ${namePoss} share shall pass to ${identify(subs[0])}, provided that ${named} survives me ` +
        `by 30 days; and if ${named} shall not so survive me, that share shall be divided among ` +
        `the other surviving residuary beneficiaries in proportion to their respective shares.${s33}`
      );
    }

    const apportioned = subs
      .map(s => `as to ${pctLabel(s.share)} thereof to ${identify(s)}`)
      .join(', and ');
    if (sub.namedFallback === 'issue') {
      return (
        `${trigger}, ${namePoss} share shall pass ${apportioned}, provided in each case that the ` +
        `substitute survives me by 30 days. If any of them shall have died in my lifetime or failed ` +
        `to survive me by 30 days, leaving children living at my death, those children shall take ` +
        `that person's part equally between them (per stirpes); if any of them shall so fail to ` +
        `survive me leaving no such children, that person's part shall pass to such of the others ` +
        `of them as shall so survive me, in proportion to their respective parts; and if no part of ` +
        `${namePoss} share passes under the foregoing provisions of this clause, it shall be ` +
        `divided among the other surviving residuary beneficiaries in proportion to their ` +
        `respective shares.${s33}`
      );
    }
    return (
      `${trigger}, ${namePoss} share shall pass ${apportioned}, provided in each case that the ` +
      `substitute survives me by 30 days. If any of them shall fail to survive me by 30 days, that ` +
      `person's part shall pass to such of the others of them as shall so survive me, in ` +
      `proportion to their respective parts; and if none of them shall so survive me, ${namePoss} ` +
      `share shall be divided among the other surviving residuary beneficiaries in proportion to ` +
      `their respective shares.${s33}`
    );
  }

  // pro-rata. The operative words do the work; a worked example based on the
  // current shares was dropped — it duplicated the provision in looser language
  // and had no place in the operative part of a will.
  return (
    `${trigger}, ${namePoss} share shall be divided among the other surviving residuary ` +
    `beneficiaries in proportion to their respective shares.${s33}`
  );
}

/**
 * Thrown instead of producing a will that cannot do its job.
 *
 * A blank form used to generate a complete, signable four-page document whose
 * revocation clause was fully operative: signing it cancelled any earlier will
 * and disposed of nothing. That outcome is worse than the app not existing, so
 * generation is now gated rather than merely discouraged.
 */
export class WillIncompleteError extends Error {
  readonly problems: WillProblem[];
  constructor(problems: WillProblem[]) {
    super(`Cannot generate a will: ${problems.length} problem(s) must be fixed first.`);
    this.name = 'WillIncompleteError';
    this.problems = problems;
  }
}

export interface GenerateOptions {
  /**
   * Render an incomplete will as a clearly-marked draft rather than refusing.
   * Every page is watermarked and the attestation carries a do-not-sign notice.
   */
  draft?: boolean;
}

/** Family declaration lines. Empty when the user told us nothing about their family. */
function familyLines(data: WillData): string[] {
  const lines: string[] = [];
  const partner = sanitizeForPdf(data.partnerName).trim();
  const partnerAddress = inlineAddress(data.partnerAddress);
  const partnerOf = partner && partnerAddress ? `${partner} of ${partnerAddress}` : partner;

  if (data.maritalStatus === 'married') {
    lines.push(partner ? `I am married to ${partnerOf}.` : 'I am married.');
  } else if (data.maritalStatus === 'civilPartnership') {
    lines.push(partner ? `I am in a civil partnership with ${partnerOf}.` : 'I am in a civil partnership.');
  } else if (data.maritalStatus === 'single') {
    lines.push('I am not married and I am not in a civil partnership.');
  } else if (data.maritalStatus === 'divorced') {
    lines.push('My marriage or civil partnership has been dissolved.');
  } else if (data.maritalStatus === 'widowed') {
    lines.push('I am a widow or widower and have not remarried or entered a new civil partnership.');
  }

  if (data.children.length > 0) {
    const described = data.children.map(child => {
      const name = field(child.name, 'child name missing');
      const born = formatDobLong(child.dob);
      return born ? `${name} (born ${born})` : name;
    });
    const count = data.children.length === 1 ? 'one child' : `${data.children.length} children`;
    lines.push(`I have ${count} living at the date of this Will, namely ${described.join(', ')}.`);
  }

  return lines;
}

export async function generateWillPdf(
  data: WillData,
  options: GenerateOptions = {}
): Promise<Uint8Array> {
  const problems = blockingProblems(data);
  const isDraft = problems.length > 0;
  if (isDraft && !options.draft) throw new WillIncompleteError(problems);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let ctx: DrawCtx = { doc, page, y: PAGE_H - MARGIN, regular, bold, italic };

  /**
   * Clauses are numbered by a running counter rather than by arithmetic on which
   * optional sections happen to be present. The old `clauseNum + (hasGifts ? 2 : 0)`
   * style was already at its limit with two conditional clauses; with five it
   * would be a guaranteed source of a will whose clauses jump from 3 to 5.
   */
  let clauseNo = 0;
  const nextClause = () => ++clauseNo;

  // ── Title ──────────────────────────────────────────────────────────────────
  ctx = gap(ctx, 20);
  ctx = drawText(ctx, 'LAST WILL AND TESTAMENT', { font: bold, size: 16, center: true });
  ctx = gap(ctx, 6);
  ctx = drawText(ctx, `of ${field(data.fullName, 'full name missing')}`, { font: italic, size: 13, center: true });
  ctx = drawText(ctx, field(data.address, 'address missing'), { size: 10, color: GRAY, center: true });
  ctx = gap(ctx, 16);
  ctx = rule(ctx);
  ctx = gap(ctx, 6);

  if (isDraft) {
    ctx = drawText(ctx, 'DRAFT — THIS DOCUMENT IS INCOMPLETE AND MUST NOT BE SIGNED', {
      font: bold, size: 11, center: true, color: RED,
    });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx, `${problems.length} item${problems.length === 1 ? '' : 's'} still need${problems.length === 1 ? 's' : ''} attention:`, {
      size: 10, color: RED,
    });
    for (const problem of problems) {
      ctx = drawText(ctx, `• ${problem.message}`, { size: 10, color: RED, indent: 16 });
    }
    ctx = gap(ctx, 10);
    ctx = rule(ctx);
    ctx = gap(ctx, 6);
  }

  // ── 1. Revocation ──────────────────────────────────────────────────────────
  // The date of birth is stated here because it is the only thing in the
  // document that separates the testator from a namesake at the same address —
  // a father and son sharing a name is not an edge case. It was collected,
  // echoed back on the review screen as confirmed, and then never printed.
  const dobLong = formatDobLong(data.dob);
  ctx = drawText(ctx, `${nextClause()}. REVOCATION OF PRIOR WILLS`, { font: bold, size: 11 });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx,
    'I, ' + field(data.fullName, 'full name missing') + ', of ' +
    field(inlineAddress(data.address), 'address missing') +
    (dobLong ? `, born on ${dobLong}` : '') +
    ', hereby revoke all former Wills and ' +
    'codicils previously made by me and declare this to be my last Will.',
    { size: 11 });

  // Wills Act 1837 s.18(3) / s.18B(3): marriage or civil partnership revokes a
  // will UNLESS it was made in expectation of that particular marriage and says
  // it is to survive it. The person must be named — an expectation of marrying
  // "whoever" does not engage the saving.
  if (data.expectingMarriage && data.intendedSpouseName.trim()) {
    const intended = sanitizeForPdf(data.intendedSpouseName).trim();
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `I make this Will in expectation of my forthcoming marriage to, or civil partnership with, ` +
      `${intended}, and I intend that this Will shall not be revoked by that marriage or civil partnership.`,
      { size: 11 });
  }
  ctx = gap(ctx, 14);

  // ── 2. Declaration as to family (conditional) ──────────────────────────────
  // Marital status, partner and children were collected and appeared in no
  // clause anywhere. A will that never mentions the testator's children is the
  // worst possible posture if a claim is later brought under the Inheritance
  // (Provision for Family and Dependants) Act 1975: it looks like an oversight
  // rather than a decision. Recording the family is a statement of fact and
  // costs nothing; it does not dispose of anything.
  const family = familyLines(data);
  if (family.length > 0) {
    ctx = drawText(ctx, `${nextClause()}. DECLARATION AS TO FAMILY`, { font: bold, size: 11 });
    ctx = gap(ctx, 4);
    for (const line of family) {
      ctx = drawText(ctx, line, { size: 11 });
      ctx = gap(ctx, 2);
    }
    ctx = gap(ctx, 12);
  }

  // ── 3. Executors ───────────────────────────────────────────────────────────
  ctx = drawText(ctx, `${nextClause()}. APPOINTMENT OF EXECUTORS`, { font: bold, size: 11 });
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
    // The clause used to read "jointly with or as a substitute for the above" —
    // both at once, which is a construction dispute at probate. The role now
    // comes from an explicit answer; a draft saved before the question existed
    // renders a marker rather than a guess.
    const exec2Named = field(exec2.name, 'second executor name missing') +
      (exec2.address.trim() ? ' of ' + inlineAddress(exec2.address) : '');
    const exec1Name = field(exec1.name, 'primary executor name missing');
    ctx = gap(ctx, 4);
    if (data.secondaryExecutorRole === 'joint') {
      ctx = drawText(ctx,
        `I also appoint ${exec2Named} to be Executor of this my Will jointly with the said ${exec1Name}.`,
        { size: 11 });
    } else if (data.secondaryExecutorRole === 'substitute') {
      ctx = drawText(ctx,
        `In the event that the said ${exec1Name} is unable or unwilling to act, I appoint ` +
        `${exec2Named} to be Executor of this my Will in their place.`,
        { size: 11 });
    } else {
      ctx = drawText(ctx,
        `I also appoint ${exec2Named} to be Executor ` +
        `[JOINTLY WITH OR AS A SUBSTITUTE FOR THE FIRST EXECUTOR — NOT YET CHOSEN].`,
        { size: 11 });
    }
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
      `I appoint ${field(backupExec.name, 'backup executor name missing')}` +
      `${backupExec.address.trim() ? ' of ' + inlineAddress(backupExec.address) : ''} as substitute Executor.`,
      { size: 11 });
  }

  ctx = gap(ctx, 14);

  // ── 4. Guardians (conditional) ─────────────────────────────────────────────
  //
  // One thing stops this clause being written at all: there is no first-choice
  // guardian. A substitute with nobody to substitute for appoints no one, and
  // guessing that they were meant as the primary would change the appointment
  // behind the user's back.
  //
  // Parental responsibility is NOT a condition here. Only someone who has it
  // can appoint (Children Act 1989 s.5(3)-(4)), but that is explained on the
  // Guardians screen rather than asked, so there is no answer to gate on — and
  // gating on a self-assessed one would mean a mistaken "no" silently deleted
  // a valid appointment. The recital below states the basis; if the testator
  // turns out not to have parental responsibility the clause is void of its
  // own accord, which is the same outcome as omitting it.
  const primaryGuardians = data.guardians.filter(g => g.role === 'primary');
  const substituteGuardians = data.guardians.filter(g => g.role === 'substitute');
  const guardianList = (list: typeof data.guardians) =>
    list
      .map(g => field(g.name, 'guardian name missing') + (g.address.trim() ? ' of ' + inlineAddress(g.address) : ''))
      .join(' and ');

  if (primaryGuardians.length > 0) {
    ctx = drawText(ctx, `${nextClause()}. APPOINTMENT OF GUARDIANS`, { font: bold, size: 11 });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `In the event of my death while any of my children are under the age of 18 years, ` +
      `I appoint ${guardianList(primaryGuardians)} to be the guardian(s) of my minor children.`,
      { size: 11 });
    ctx = gap(ctx, 6);

    if (substituteGuardians.length > 0) {
      // Spelled out rather than left to "if my appointment fails", because the
      // joint case is the one people get wrong: appoint a couple, one of them
      // dies, and the question is whether the survivor carries on alone or the
      // substitute joins them. The survivor does.
      const joint = primaryGuardians.length > 1;
      ctx = drawText(ctx,
        (joint
          ? `If none of the guardians appointed above is able and willing to act — because they have `
          : `If the guardian appointed above is not able and willing to act — because they have `) +
        `died before me, or are unable or unwilling to act — then I appoint ` +
        `${guardianList(substituteGuardians)} to be the guardian(s) of my minor children in their place.` +
        (joint
          ? ` Where any one of the guardians appointed above is able and willing to act, that guardian ` +
            `shall act alone and this substitution shall not take effect.`
          : ''),
        { size: 11 });
      ctx = gap(ctx, 6);
    }

    // Children Act 1989 s.5(7)-(8). Without this the appointment reads as though
    // it takes effect on death whatever happens, which for most parents is not
    // what the law does: where the child still has a surviving parent with
    // parental responsibility, the appointment waits.
    ctx = drawText(ctx,
      `This appointment is made under section 5(3) of the Children Act 1989. I understand that where, ` +
      `on my death, my child still has a parent with parental responsibility for them, this appointment ` +
      `does not take effect immediately but takes effect when the child no longer has a parent with ` +
      `parental responsibility — unless at my death there is a child arrangements order naming me as a ` +
      `person with whom the child was to live, or I was the child's only or last surviving special ` +
      `guardian, in which case it takes effect on my death.`,
      { size: 10, color: GRAY, indent: 16 });
    ctx = gap(ctx, 14);
  }

  // ── 5. Specific Gifts (conditional) ────────────────────────────────────────
  if (data.specificGifts.length > 0) {
    ctx = drawText(ctx, `${nextClause()}. SPECIFIC GIFTS`, { font: bold, size: 11 });
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
        ? `If ${recipient} shall have ceased to exist or amalgamated with another charity or body at my death`
        : `If ${recipient} shall fail to survive me by 30 days`;

      // The named alternatives, read from the list. A fixture or a draft saved
      // under the old single free-text field is read through the legacy field so
      // it still drafts, exactly as the residuary path tolerates a namedPerson.
      const giftSubs: { name: string; address?: string }[] =
        Array.isArray((gift as any).substitutionRecipients) && (gift as any).substitutionRecipients.length > 0
          ? (gift as any).substitutionRecipients
          : (typeof (gift as any).substitutionRecipient === 'string' && (gift as any).substitutionRecipient.trim()
              ? [{ name: (gift as any).substitutionRecipient, address: '' }]
              : []);
      const giftFallback = (gift as any).substitutionFallback === 'issue' ? 'issue' : 'survivors';

      // The address rides with the first mention of a name only, as everywhere
      // else in the will — identify once, refer back after.
      const identifyGiftSub = (s: { name: string; address?: string }): string =>
        field(s.name, 'alternative recipient name missing') +
        (typeof s.address === 'string' && s.address.trim() ? ` of ${inlineAddress(s.address)}` : '');
      const listNames = (arr: string[]): string =>
        arr.length <= 1 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;

      let failClause: string;
      if (gift.substitutionType === 'per-stirpes') {
        // To the recipient's own children, then down to their issue — the same
        // double-limb (died in my lifetime OR failed to survive me by 30 days)
        // as the residuary per-stirpes clause, so a child who outlives me but
        // dies inside the window still passes their branch down. The ultimate
        // limb here is residue, not the other beneficiaries: a gift that fails
        // all the way through has always fallen into the estate.
        const rPoss = `${recipient}'s`;
        failClause =
          `${failTrigger}, this gift shall pass in equal shares to such of ${rPoss} children as shall ` +
          `survive me by 30 days; if any child of ${recipient} shall have died in my lifetime or failed ` +
          `to survive me by 30 days, leaving children of their own living at my death, those ` +
          `grandchildren shall take their parent's share equally between them (per stirpes); and if no ` +
          `child or issue of ${recipient} shall so survive me, this gift shall fall into and form part ` +
          `of my residuary estate.`;
      } else if (gift.substitutionType === 'named') {
        // The alternatives take on the same 30-day condition as every other
        // taker, and the gift has somewhere to go if an alternative has also
        // died — without that limb it lapsed into residue by silence rather than
        // by words. A specific gift is usually one indivisible thing, so named
        // alternatives take it JOINTLY: no apportionment, and if one goes first
        // the others take the whole between them before residue is reached.
        const takers = giftSubs.length > 0 ? giftSubs : [{ name: '', address: '' }];
        if (takers.length === 1) {
          const only = identifyGiftSub(takers[0]);
          const onlyName = field(takers[0].name, 'alternative recipient name missing');
          if (giftFallback === 'issue') {
            failClause =
              `${failTrigger}, this gift shall pass to ${only}, provided that ${onlyName} survives me by ` +
              `30 days. If ${onlyName} shall have died in my lifetime or failed to survive me by 30 days, ` +
              `leaving children living at my death, those children shall take this gift equally between ` +
              `them (per stirpes); and if ${onlyName} shall not so survive me and shall leave no such ` +
              `children, this gift shall fall into and form part of my residuary estate.`;
          } else {
            failClause =
              `${failTrigger}, this gift shall pass to ${only}, provided that ${onlyName} survives me by ` +
              `30 days; and if ${onlyName} shall not so survive me, this gift shall fall into and form ` +
              `part of my residuary estate.`;
          }
        } else {
          const joined = listNames(takers.map(identifyGiftSub));
          if (giftFallback === 'issue') {
            failClause =
              `${failTrigger}, this gift shall pass to ${joined} jointly, provided in each case that the ` +
              `taker survives me by 30 days. If any of them shall have died in my lifetime or failed to ` +
              `survive me by 30 days, leaving children living at my death, those children shall take that ` +
              `person's share equally between them (per stirpes); if any of them shall so fail to survive ` +
              `me leaving no such children, that person's share shall pass to such of the others of them ` +
              `as shall so survive me; and if this gift passes to none of them under the foregoing ` +
              `provisions, it shall fall into and form part of my residuary estate.`;
          } else {
            failClause =
              `${failTrigger}, this gift shall pass to ${joined} jointly, provided in each case that the ` +
              `taker survives me by 30 days; if any of them shall fail to survive me by 30 days, this gift ` +
              `shall pass to such of them as shall so survive me; and if none of them shall so survive me, ` +
              `this gift shall fall into and form part of my residuary estate.`;
          }
        }
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

  // ── 6. Burden of inheritance tax (conditional) ─────────────────────────────
  // Only meaningful once there is a specific gift to allocate tax between. The
  // default rule (IHTA 1984 s.211) already sends tax on UK free-estate property
  // to residue as a testamentary expense, but it is silent on gifts the testator
  // wants the recipient to bear, and it says nothing about what happens when
  // residue cannot carry the charge. Both are spelled out here.
  const hasGifts = data.specificGifts.length > 0;

  if (hasGifts) {
    const chargeableGifts = data.specificGifts.filter(g => !g.isCharity);
    const anyFreeOfTax = chargeableGifts.some(g => g.taxBurden === 'freeOfTax');

    ctx = drawText(ctx, `${nextClause()}. BURDEN OF INHERITANCE TAX`, { font: bold, size: 11 });
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

  // ── 7. Residuary ───────────────────────────────────────────────────────────
  ctx = drawText(ctx, `${nextClause()}. RESIDUARY ESTATE`, { font: bold, size: 11 });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx,
    `I give all my real and personal estate (including any property over which I have a power of appointment) ` +
    `not otherwise disposed of by this Will, after payment of all my debts, funeral and testamentary expenses, ` +
    `to the following beneficiaries in the proportions stated:`,
    { size: 11 });
  ctx = gap(ctx, 6);

  // An empty list under a clause that has just promised one reads as finished
  // prose — the sentence ends in a colon and the next heading follows. Every
  // scalar field gets a bracketed marker when it is blank; a collection needs
  // one too.
  if (data.beneficiaries.length === 0) {
    ctx = drawText(ctx, '[NO BENEFICIARIES NAMED — THIS WILL DISPOSES OF NOTHING]', {
      size: 11, indent: 16, font: bold, color: RED,
    });
  }

  for (const b of data.beneficiaries) {
    // A charity is labelled as one, and never gets the minor-trust suffix —
    // an organisation cannot be under 18, and printing trust machinery against
    // it would be a defect on the face of the will.
    ctx = drawText(ctx,
      `• ${field(b.name, 'beneficiary name missing')}` +
      `${b.isCharity ? ' (a registered charity)' : b.relationship.trim() ? ' (' + sanitizeForPdf(b.relationship).trim() + ')' : ''}` +
      ` — ${pctLabel(b.percentage)}` +
      `${!b.isCharity && b.isMinor ? ' (held on trust until age 18)' : ''}`,
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

  if (data.beneficiaries.length === 0) {
    ctx = drawText(ctx, '[NO BENEFICIARIES NAMED]', { size: 11, indent: 16, font: bold, color: RED });
    ctx = gap(ctx, 6);
  }

  for (let i = 0; i < data.beneficiaries.length; i++) {
    const b = data.beneficiaries[i];
    ctx = drawText(ctx,
      `(${giftLetter(i)}) ${substitutionClause(b)}`,
      { size: 11, indent: 16 });
    ctx = gap(ctx, 6);
  }

  // ── Ultimate backstop ─────────────────────────────────────────────────────
  // A sweep-up, not a whole-estate condition. The old words — "If no residuary
  // beneficiary or their substituted beneficiary shall survive me..." — could
  // not fire while ANY beneficiary survived, so a single branch whose takers
  // had all died fell into intestacy from a will that read complete. "If and
  // so far as" catches any part left undisposed of, however it got there.
  ctx = gap(ctx, 4);
  if (data.ultimateBackstop.trim()) {
    ctx = drawText(ctx,
      `If and so far as any part of my residuary estate is not effectively disposed of by the ` +
      `foregoing provisions of this clause, that part shall pass to ` +
      `${sanitizeForPdf(data.ultimateBackstop).trim()} absolutely.`,
      { size: 11 });
  } else {
    ctx = drawText(ctx,
      `If and so far as any part of my residuary estate is not effectively disposed of by the ` +
      `foregoing provisions of this clause, that part shall pass in accordance with the laws of ` +
      `intestacy as if I had died without a Will.`,
      { size: 11 });
  }

  // ── Trusts for minor beneficiaries ────────────────────────────────────────
  const minorBens = data.beneficiaries.filter(b => b.isMinor && !b.isCharity);
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
    // The substitution provisions are all conditioned on failing to survive by
    // 30 days; a minor who survives the 30 days and then dies at, say, ten is
    // outside their literal words. "As if" bridges the two so the machinery
    // this clause points at can actually operate.
    ctx = drawText(ctx,
      `(d) If such beneficiary dies before attaining the age of 18, their share shall pass as if that ` +
      `beneficiary had failed to survive me by 30 days, in accordance with the substitution provisions ` +
      `set out above.`,
      { size: 11, indent: 16 });
  }

  ctx = gap(ctx, 14);

  // ── 8. Powers of executors and trustees ────────────────────────────────────
  // The statutory powers (Trustee Act 1925 ss.31-32, Trustee Act 2000) do most
  // of the work, but they leave three real gaps: without an express charging
  // clause a professional executor cannot charge and will usually renounce;
  // without a power to appropriate free of the consents required by AEA 1925
  // s.41 the executors must go back to every beneficiary to hand over an asset
  // in specie; and there is no express power to postpone sale.
  ctx = drawText(ctx, `${nextClause()}. POWERS OF MY EXECUTORS AND TRUSTEES`, { font: bold, size: 11 });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx,
    `In addition to the powers conferred on them by law, my Executors and Trustees shall have the ` +
    `following powers:`,
    { size: 11 });
  ctx = gap(ctx, 6);
  const powers = [
    `(a) To postpone the sale, calling in and conversion of the whole or any part of my estate for as ` +
      `long as they think fit, without being liable for any loss arising from that postponement.`,
    `(b) To appropriate any asset of my estate towards any share or interest in my estate, at such value ` +
      `as they consider fair, without needing the consents required by section 41 of the Administration ` +
      `of Estates Act 1925.`,
    `(c) To insure any asset of my estate for any amount and against any risk, and to pay the premiums ` +
      `out of income or capital.`,
    `(d) To invest and to apply capital as freely as if they were absolute beneficial owners, including ` +
      `in non-income-producing assets.`,
    `(e) To employ and pay solicitors, accountants, agents and other professionals, and to act on their ` +
      `advice without being liable for any loss arising from doing so in good faith.`,
    `(f) Any of my Executors or Trustees who is engaged in a profession or business may charge for work ` +
      `done by them or their firm in the administration of my estate, including work that a person ` +
      `acting without professional qualification could have done personally.`,
  ];
  for (const power of powers) {
    ctx = drawText(ctx, power, { size: 11, indent: 16 });
    ctx = gap(ctx, 4);
  }
  ctx = gap(ctx, 10);

  // ── 9. Funeral Wishes (conditional) ────────────────────────────────────────
  // The body is assembled before anything is drawn so the section can be
  // dropped whole when there is nothing to say. Guarding on
  // `funeralWishes || burialPreference` was not enough: "No preference" stores
  // the truthy 'noPreference', which draws no body line, so the heading and the
  // "I express the following wishes..." preamble printed with nothing under
  // them. Whitespace-only free text did the same.
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
    ctx = drawText(ctx, `${nextClause()}. FUNERAL WISHES`, { font: bold, size: 11 });
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
  ctx = ensureSpace(ctx, 240);
  ctx = rule(ctx);
  ctx = gap(ctx, 6);
  ctx = drawText(ctx, 'ATTESTATION', { font: bold, size: 12, center: true });
  ctx = gap(ctx, 8);

  if (isDraft) {
    ctx = drawText(ctx, 'DO NOT SIGN — this draft is incomplete. Signing it would revoke any earlier Will you have made.', {
      font: bold, size: 11, color: RED,
    });
    ctx = gap(ctx, 10);
  }

  ctx = drawText(ctx,
    `SIGNED by the above-named Testator as their last Will in our presence and then by us in the presence of ` +
    `the Testator and of each other:`,
    { size: 11 });
  ctx = gap(ctx, 14);

  // One date, in one place. The document used to print the date it was
  // generated at the top AND leave a blank date line here, so a will signed a
  // week after download carried two different dates — which invites the Probate
  // Registry to ask for affidavit evidence of the true execution date, and
  // raises the suspicion of page substitution. Dating also matters in its own
  // right: Children Act 1989 s.5(5) requires a guardian appointment to be dated.
  ctx = drawText(ctx, 'DATE OF SIGNING (write the date here, in your own hand, on the day you sign):', {
    font: bold, size: 10,
  });
  ctx = gap(ctx, 6);
  ctx = ensureSpace(ctx, 28);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 0.5,
    color: GRAY,
  });
  ctx = { ...ctx, y: ctx.y - 20 };

  ctx = sigBlock(ctx, 'TESTATOR', ['Signature']);
  ctx = gap(ctx, 12);
  // s.15 Wills Act 1837, as extended by the Civil Partnership Act 2004: a gift
  // is void where the witness is a beneficiary, or a beneficiary's spouse OR
  // civil partner. The label at the signature line is the one that gets read
  // on the day, so it has to carry the full rule, not a paraphrase of it.
  ctx = sigBlock(ctx, 'WITNESS 1 (must not be a beneficiary or the spouse or civil partner of a beneficiary)', [
    'Signature', 'Full name', 'Address', 'Occupation',
  ]);
  ctx = gap(ctx, 12);
  ctx = sigBlock(ctx, 'WITNESS 2 (must not be a beneficiary or the spouse or civil partner of a beneficiary)', [
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
    ['5. Fill in the date',
     'Write the date on the "DATE OF SIGNING" line on the day you sign — not before. If your Will appoints a ' +
     'guardian for your children, the appointment must be dated to be effective (Children Act 1989, section 5(5)), ' +
     'so leaving the date blank can undo it.'],
    ['6. No alterations after signing',
     'Once signed and witnessed, do not alter the Will. Any amendment must be done by a new codicil or a fresh Will.'],
    ['7. Store safely',
     'Keep the original Will in a safe place — a solicitor\'s safe, a bank, or the Probate Registry. ' +
     'Tell your Executors where to find it.'],
  ];

  for (const [title, body] of instructions) {
    ctx = drawText(ctx, title, { font: bold, size: 11 });
    ctx = gap(ctx, 2);
    ctx = drawText(ctx, body, { size: 11 });
    ctx = gap(ctx, 10);
  }

  // Four things routinely undo a will that was correctly signed. None of them
  // are visible from inside the document, so they are stated here.
  ctx = gap(ctx, 4);
  ctx = drawText(ctx, 'WHAT CAN CHANGE OR OVERRIDE THIS WILL', { font: bold, size: 12 });
  ctx = gap(ctx, 8);
  const afterwards: [string, string][] = [
    ['Marriage or civil partnership revokes it',
     'Getting married or entering a civil partnership automatically revokes your Will (Wills Act 1837, section 18) ' +
     'unless it was made in express expectation of that marriage. Make a new Will after you marry.'],
    ['Divorce or dissolution changes it',
     'If your marriage or civil partnership ends, your former spouse or civil partner is treated as having died ' +
     'before you (Wills Act 1837, section 18A). Any gift to them and any appointment of them as executor fails, ' +
     'which can leave part of your estate undisposed of.'],
    ['Jointly owned property may pass outside this Will',
     'Property you own as beneficial joint tenants — commonly a home or a joint bank account — passes automatically ' +
     'to the surviving owner by survivorship, whatever this Will says. If you want your share to pass under your ' +
     'Will, the joint tenancy must be severed first.'],
    ['Certain people can claim against your estate',
     'A spouse, civil partner, former spouse, cohabitee of at least two years, child, or someone you were ' +
     'maintaining can apply to the court for provision from your estate under the Inheritance (Provision for ' +
     'Family and Dependants) Act 1975, normally within six months of the grant of probate. Leaving someone out ' +
     'does not always end the matter.'],
  ];
  for (const [title, body] of afterwards) {
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
    font: bold, size: 11, center: true, color: RED,
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

  // ── Page furniture ─────────────────────────────────────────────────────────
  // Numbered pages naming the testator make a substituted or missing page
  // obvious; the draft watermark has to go on every page, including ones that
  // did not exist when the draft banner was drawn.
  const pages = doc.getPages();
  const footerName = sanitizeForPdf(data.fullName).trim();
  pages.forEach((p, index) => {
    if (isDraft) {
      const mark = 'DRAFT — DO NOT SIGN';
      const markSize = 46;
      const markWidth = bold.widthOfTextAtSize(mark, markSize);
      // Centred on the diagonal: rotating about the anchor means the text runs
      // up and to the right, so the start point is offset back along that line.
      p.drawText(mark, {
        x: PAGE_W / 2 - (markWidth / 2) * Math.cos(Math.PI / 4),
        y: PAGE_H / 2 - (markWidth / 2) * Math.sin(Math.PI / 4),
        size: markSize,
        font: bold,
        color: RED,
        opacity: 0.18,
        rotate: degrees(45),
      });
    }
    const footer = `${footerName ? footerName + ' — ' : ''}Last Will and Testament — Page ${index + 1} of ${pages.length}`;
    // Clamped: a very long name makes the centring arithmetic go negative and
    // the footer walks off the left edge of the page.
    p.drawText(footer, {
      x: Math.max(MARGIN, MARGIN + (CONTENT_W - regular.widthOfTextAtSize(footer, 8)) / 2),
      y: 42,
      size: 8,
      font: regular,
      color: GRAY,
    });
  });

  return doc.save();
}

/**
 * Age of the testator at the date of the document, when it can be established.
 * Exported for the review screen, which shows it back so an obviously wrong
 * year of birth is caught before the document is produced rather than after.
 */
export function testatorAge(data: WillData): number | null {
  const dob = parseUkDate(data.dob);
  return dob ? ageInYears(dob) : null;
}
