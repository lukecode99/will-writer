import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { WillData } from './types';

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

function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
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
  ctx = drawText(ctx, `of ${data.fullName}`, { font: italic, size: 13, center: true });
  ctx = drawText(ctx, data.address, { size: 10, color: GRAY, center: true });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx, `Made this day: ${today}`, { size: 10, color: GRAY, center: true });
  ctx = gap(ctx, 16);
  ctx = rule(ctx);
  ctx = gap(ctx, 6);

  // ── Revocation ─────────────────────────────────────────────────────────────
  ctx = drawText(ctx, 'REVOCATION OF PRIOR WILLS', { font: bold, size: 11 });
  ctx = gap(ctx, 4);
  ctx = drawText(ctx,
    'I, ' + data.fullName + ', of ' + data.address + ', hereby revoke all former Wills and ' +
    'codicils previously made by me and declare this to be my last Will.',
    { size: 11 });
  ctx = gap(ctx, 14);

  // ── Executors ──────────────────────────────────────────────────────────────
  ctx = drawText(ctx, '1. APPOINTMENT OF EXECUTORS', { font: bold, size: 11 });
  ctx = gap(ctx, 4);

  const exec1 = data.primaryExecutor;
  const exec2 = data.secondaryExecutor;
  const backup = data.backupExecutor;

  ctx = drawText(ctx,
    `I appoint ${exec1.name || '[Primary Executor]'}${exec1.address ? ' of ' + exec1.address : ''} ` +
    `to be the Executor of this my Will.`,
    { size: 11 });

  if (exec2.name) {
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `I also appoint ${exec2.name}${exec2.address ? ' of ' + exec2.address : ''} ` +
      `to be Executor jointly with or as a substitute for the above.`,
      { size: 11 });
  }

  if (backup.name) {
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `In the event that neither of the foregoing Executors is able or willing to act, ` +
      `I appoint ${backup.name}${backup.address ? ' of ' + backup.address : ''} as substitute Executor.`,
      { size: 11 });
  }

  ctx = gap(ctx, 14);

  // ── Guardians ──────────────────────────────────────────────────────────────
  if (data.guardians.length > 0) {
    ctx = drawText(ctx, '2. APPOINTMENT OF GUARDIANS', { font: bold, size: 11 });
    ctx = gap(ctx, 4);
    const gNames = data.guardians.map(g => g.name + (g.address ? ' of ' + g.address : '')).join(' and ');
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
      if (gift.isCharity) {
        ctx = drawText(ctx,
          `${String.fromCharCode(97 + i)}) I give ${gift.description} to ${gift.recipient} ` +
          `(a registered charity) free of inheritance tax, to be applied for its general purposes.`,
          { size: 11 });
      } else {
        ctx = drawText(ctx,
          `${String.fromCharCode(97 + i)}) I give ${gift.description} to ${gift.recipient} ` +
          `free of inheritance tax, absolutely.`,
          { size: 11 });
      }
      ctx = gap(ctx, 4);
    }
    ctx = gap(ctx, 10);
  }

  // ── Residuary ──────────────────────────────────────────────────────────────
  const resNum = clauseNum + (data.specificGifts.length > 0 ? 1 : 0);
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
      `• ${b.name}${b.relationship ? ' (' + b.relationship + ')' : ''} — ${b.percentage}%`,
      { size: 11, indent: 16 });
  }

  if (data.residuaryBackup) {
    ctx = gap(ctx, 6);
    ctx = drawText(ctx,
      `If any beneficiary shall fail to survive me by 30 days, their share shall pass to: ${data.residuaryBackup}.`,
      { size: 11 });
  }
  ctx = gap(ctx, 14);

  // ── Funeral Wishes ─────────────────────────────────────────────────────────
  const funeralNum = resNum + 1;
  if (data.funeralWishes || data.burialPreference) {
    ctx = drawText(ctx, `${funeralNum}. FUNERAL WISHES`, { font: bold, size: 11 });
    ctx = gap(ctx, 4);
    ctx = drawText(ctx,
      `I express the following wishes regarding my funeral (without imposing any legal obligation on my Executors):`,
      { size: 11 });
    ctx = gap(ctx, 4);

    if (data.burialPreference === 'burial') {
      ctx = drawText(ctx, `I wish to be buried.`, { size: 11, indent: 16 });
    } else if (data.burialPreference === 'cremation') {
      ctx = drawText(ctx, `I wish to be cremated.`, { size: 11, indent: 16 });
    }

    if (data.funeralWishes) {
      ctx = drawText(ctx, data.funeralWishes, { size: 11, indent: 16 });
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

  const instructions = [
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
