// Standalone proof of the branded "How to sign your will" one-pager.
// Uses the SAME engine (pdf-lib) as src/pdfGen.ts so the proof is faithful.
// Once approved, the drawSigningGuide() body is ported into pdfGen.ts and
// inserted as page 1 (front) of every generated / printed will.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

// SortedWill brand
const NAVY = rgb(0.106, 0.227, 0.42);   // #1B3A6B
const INK = rgb(0.13, 0.15, 0.19);
const MUTED = rgb(0.42, 0.45, 0.5);
const HAIR = rgb(0.80, 0.83, 0.88);
const BOXBG = rgb(0.95, 0.96, 0.98);
const BOXBAR = rgb(0.85, 0.30, 0.24);   // warm red accent for the warning box

export async function drawSigningGuide(doc, helv, bold) {
  const page = doc.insertPage(0, [PAGE_W, PAGE_H]);
  const W = PAGE_W - MARGIN * 2;
  let y = PAGE_H - MARGIN;

  // simple word-wrap
  const wrap = (text, font, size, maxW) => {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const para = (text, { font = helv, size = 10.5, color = INK, x = MARGIN, maxW = W, lh = 14, gap = 0 } = {}) => {
    for (const ln of wrap(text, font, size, maxW)) {
      page.drawText(ln, { x, y, size, font, color });
      y -= lh;
    }
    y -= gap;
  };

  // ---- Brand header ----
  page.drawText('SortedWill', { x: MARGIN, y: y - 4, size: 22, font: bold, color: NAVY });
  page.drawText('sortedwill.co.uk', {
    x: PAGE_W - MARGIN - helv.widthOfTextAtSize('sortedwill.co.uk', 10),
    y: y + 2, size: 10, font: helv, color: MUTED,
  });
  y -= 20;
  page.drawRectangle({ x: MARGIN, y: y, width: W, height: 3, color: NAVY });
  y -= 30;

  page.drawText('How to sign your will', { x: MARGIN, y, size: 19, font: bold, color: INK });
  y -= 24;
  para(
    'Your will is not legally valid until you sign it correctly, in front of the right witnesses. It takes five minutes. Follow these steps exactly.',
    { color: MUTED, size: 11, lh: 15, gap: 14 },
  );

  // ---- Numbered steps ----
  const steps = [
    ['Get two witnesses together',
      'Ask two adults (18 or over, of sound mind) to witness your signature. Both must be in the room with you at the same time — not one after the other.'],
    ['Check your witnesses can act',
      'A witness — or their husband, wife or civil partner — must not be anyone who inherits under this will. If they are, they lose their gift. Neighbours, friends or colleagues who gain nothing are ideal.'],
    ['Sign and date it yourself, in front of both',
      'Using the signature line at the end of the will, sign your normal signature and write the date while both witnesses watch. Use a single pen in blue or black ink.'],
    ['Each witness signs while you watch',
      'Straight after you — and while you are still watching — each witness signs and prints their full name and address on the same page. The simplest way to be sure is for all three of you to stay together until everyone has signed.'],
    ['Do not change anything afterwards',
      'Do not remove the staple, add notes, cross anything out or attach documents. Any alteration after signing can invalidate the whole will.'],
    ['Store it safely and tell your executors',
      'Keep the signed original flat, dry and secure, and make sure your executors know where to find it. Only the signed original has legal effect — a photocopy does not.'],
  ];

  const numR = 10;
  steps.forEach(([title, body], i) => {
    const cx = MARGIN + numR;
    const cy = y - numR + 2;
    page.drawCircle({ x: cx, y: cy, size: numR, color: NAVY });
    const n = String(i + 1);
    page.drawText(n, {
      x: cx - bold.widthOfTextAtSize(n, 11) / 2, y: cy - 4, size: 11, font: bold, color: rgb(1, 1, 1),
    });
    const tx = MARGIN + numR * 2 + 10;
    const tW = W - (numR * 2 + 10);
    page.drawText(title, { x: tx, y: y - 3, size: 11.5, font: bold, color: NAVY });
    y -= 16;
    para(body, { x: tx, maxW: tW, size: 10, lh: 13.5, gap: 10 });
  });

  y -= 4;

  // ---- Warning callout box ----
  const boxTitle = 'Who cannot witness your will';
  const boxBody =
    'Anyone who benefits from the will, and the husband, wife or civil partner of anyone who benefits. Under-18s. Your executors can witness it, but only if they inherit nothing.';
  const boxLines = wrap(boxBody, helv, 10, W - 28);
  const boxH = 18 + 16 + boxLines.length * 13.5 + 12;
  const boxTop = y;
  page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: W, height: boxH, color: BOXBG });
  page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width: 4, height: boxH, color: BOXBAR });
  let by = boxTop - 18;
  page.drawText(boxTitle, { x: MARGIN + 16, y: by, size: 11, font: bold, color: BOXBAR });
  by -= 16;
  for (const ln of boxLines) {
    page.drawText(ln, { x: MARGIN + 16, y: by, size: 10, font: helv, color: INK });
    by -= 13.5;
  }
  y = boxTop - boxH - 24;

  // ---- Footer ----
  page.drawLine({
    start: { x: MARGIN, y: MARGIN + 20 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 20 },
    thickness: 0.75, color: HAIR,
  });
  page.drawText('SortedWill', { x: MARGIN, y: MARGIN + 6, size: 9, font: bold, color: NAVY });
  const right = 'Your will follows on the next page.';
  page.drawText(right, {
    x: PAGE_W - MARGIN - helv.widthOfTextAtSize(right, 9), y: MARGIN + 6, size: 9, font: helv, color: MUTED,
  });

  return page;
}

// ---- proof harness ----
const doc = await PDFDocument.create();
const helv = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
await drawSigningGuide(doc, helv, bold);
const bytes = await doc.save();
writeFileSync(new URL('./signing-guide-proof.pdf', import.meta.url), bytes);
console.log('wrote signing-guide-proof.pdf', bytes.length, 'bytes');
