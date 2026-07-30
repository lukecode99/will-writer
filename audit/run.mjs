/**
 * Audit harness for will-writer — round 2.
 *
 * Round 1 rendered every scenario and left me to read the output. That found
 * real bugs, but it also means the pass/fail judgement lives in my head, and a
 * regression a month from now would need me to read all of it again. Round 2
 * still writes the full text of every document, but each scenario now also
 * carries assertions about what must and must not appear in it, so re-running
 * this is a test rather than a reading exercise.
 *
 * Two things are checked per scenario:
 *   1. the verdict — does `generateWillPdf` produce a document, or refuse, and
 *      does the refusal name the right problems;
 *   2. the words on the page — the draft render is always produced (with
 *      `{draft:true}`) so a refused scenario can still be read, and asserted
 *      against.
 *
 * Runs src/pdfGen.ts through sucrase's require hook — no installs needed.
 * Text extraction monkey-patches PDFPage.prototype.drawText BEFORE importing
 * pdfGen, recording every string drawn in order with its page, x and y. That
 * gives the literal words in layout order, which is what we want to read. The
 * real .pdf bytes are written alongside.
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(__dirname, 'out');
mkdirSync(OUT, { recursive: true });

const require = createRequire(join(ROOT, 'package.json'));

// --- sucrase require hook: lets us require() .ts files ---------------------
require('sucrase/register/ts');

// --- monkey-patch drawText to record every string ------------------------
const pdfLib = require('pdf-lib');
const { PDFPage, PDFDocument } = pdfLib;

let recording = null; // array of {page, x, y, text}
let pageSeq = new WeakMap();
let pageCounter = 0;

const origDrawText = PDFPage.prototype.drawText;
PDFPage.prototype.drawText = function (text, options) {
  if (recording) {
    if (!pageSeq.has(this)) pageSeq.set(this, ++pageCounter);
    recording.push({
      page: pageSeq.get(this),
      x: options && options.x,
      y: options && options.y,
      size: options && options.size,
      text: String(text),
    });
  }
  return origDrawText.call(this, text, options);
};

// also record addPage order so page numbers are stable
const origAddPage = PDFDocument.prototype.addPage;
PDFDocument.prototype.addPage = function (...args) {
  const p = origAddPage.apply(this, args);
  if (recording && !pageSeq.has(p)) pageSeq.set(p, ++pageCounter);
  return p;
};

// --- load the app's own code ----------------------------------------------
const { generateWillPdf, WillIncompleteError } = require(join(ROOT, 'src/pdfGen.ts'));
const { blockingProblems, warnings } = require(join(ROOT, 'src/validation.ts'));

const scenarios = require(join(__dirname, 'scenarios.js'));
const { EXPECTATIONS } = require(join(__dirname, 'expectations.js'));

function render(records) {
  // group by page, preserve draw order within page
  const byPage = new Map();
  for (const r of records) {
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(r);
  }
  const lines = [];
  for (const [pageNo, recs] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`===== PAGE ${pageNo} =====`);
    // group draws that share a y (same visual line), in draw order
    let curY = null;
    let buf = [];
    const flush = () => {
      if (buf.length) lines.push(buf.join(''));
      buf = [];
    };
    for (const r of recs) {
      if (curY === null || Math.abs(r.y - curY) > 0.5) {
        flush();
        curY = r.y;
      }
      buf.push(r.text);
    }
    flush();
    lines.push('');
  }
  return lines.join('\n');
}

/** Renders one scenario, returning {status, pages, records, error}. */
async function attempt(data, options) {
  pageCounter = 0;
  pageSeq = new WeakMap();
  recording = [];
  let status = 'ok';
  let error = null;
  let bytes = null;
  try {
    bytes = await generateWillPdf(data, options);
  } catch (e) {
    status = e instanceof WillIncompleteError ? 'REFUSED' : 'THREW';
    error = e;
  }
  const records = recording;
  recording = null;
  return { status, pages: pageCounter, records, error, bytes };
}

const results = [];
let totalFailures = 0;

for (const [name, data] of Object.entries(scenarios)) {
  const problems = blockingProblems(data);
  const advisories = warnings(data);

  // The strict pass is the one that decides the verdict.
  const strict = await attempt(data, {});
  // The draft pass always renders, so a refused document is still readable —
  // and so the DRAFT watermark itself can be asserted on.
  const draft = await attempt(data, { draft: true });

  const strictText = render(strict.records);
  const draftText = render(draft.records);

  // Assertions run against whichever document the app would actually hand over:
  // the finished one if it produced one, otherwise the draft.
  const shown = strict.status === 'ok' ? strictText : draftText;
  const expect = EXPECTATIONS[name];
  const failures = [];

  if (!expect) {
    failures.push('NO EXPECTATIONS DEFINED for this scenario');
  } else {
    if (expect.verdict && expect.verdict !== strict.status) {
      failures.push(`verdict: expected ${expect.verdict}, got ${strict.status}` +
        (strict.error ? ` (${strict.error.message})` : ''));
    }
    for (const needle of expect.mustContain || []) {
      if (!shown.includes(needle)) failures.push(`missing: ${JSON.stringify(needle)}`);
    }
    for (const needle of expect.mustNotContain || []) {
      if (shown.includes(needle)) failures.push(`present but must not be: ${JSON.stringify(needle)}`);
    }
    for (const needle of expect.problemsMention || []) {
      if (!problems.some(p => p.message.includes(needle))) {
        failures.push(`no blocking problem mentions ${JSON.stringify(needle)}`);
      }
    }
    if (expect.check) {
      const extra = expect.check({ shown, strict, draft, problems, advisories, data }) || [];
      failures.push(...extra);
    }
  }

  if (strict.status === 'THREW') {
    failures.push(`unexpected crash: ${strict.error && strict.error.message}`);
  }

  totalFailures += failures.length;

  let body = '';
  body += `SCENARIO:  ${name}\n`;
  body += `VERDICT:   ${strict.status}\n`;
  body += `PAGES:     strict=${strict.pages} draft=${draft.pages}\n`;
  body += `ASSERTIONS: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`;
  for (const f of failures) body += `  ✗ ${f}\n`;
  body += `\nBLOCKING PROBLEMS (${problems.length}):\n`;
  for (const p of problems) body += `  [${p.step}] ${p.message}\n`;
  body += `\nWARNINGS (${advisories.length}):\n`;
  for (const w of advisories) body += `  [${w.step}] ${w.message}\n`;
  if (strict.error) {
    body += `\nREFUSAL: ${strict.error.message}\n`;
    if (strict.status === 'THREW') body += `STACK:\n${strict.error.stack}\n`;
  }
  body += `\nINPUT:\n${JSON.stringify(data, null, 2)}\n`;
  body += `\n----- DOCUMENT AS THE USER WOULD RECEIVE IT -----\n`;
  body += shown;
  if (strict.status === 'ok') {
    body += `\n----- DRAFT RENDER (for comparison) -----\n`;
    body += draftText;
  }
  body += `\n----- RAW DRAW LIST (${strict.status === 'ok' ? 'strict' : 'draft'}) -----\n`;
  for (const r of (strict.status === 'ok' ? strict.records : draft.records)) {
    body += `[p${r.page} y=${r.y != null ? Number(r.y).toFixed(1) : '?'} x=${r.x != null ? Number(r.x).toFixed(1) : '?'}] ${JSON.stringify(r.text)}\n`;
  }

  writeFileSync(join(OUT, `${name}.txt`), body, 'utf8');
  if (strict.bytes) writeFileSync(join(OUT, `${name}.pdf`), Buffer.from(strict.bytes));
  else if (draft.bytes) writeFileSync(join(OUT, `${name}.draft.pdf`), Buffer.from(draft.bytes));

  results.push({
    name,
    verdict: strict.status,
    pages: strict.pages || draft.pages,
    blocking: problems.length,
    warnings: advisories.length,
    failures,
  });

  const tag = failures.length === 0 ? 'PASS' : 'FAIL';
  console.log(
    `${tag}  ${name.padEnd(32)} verdict=${strict.status.padEnd(7)} ` +
    `pages=${strict.pages || draft.pages} blocking=${problems.length} warn=${advisories.length}` +
    (failures.length ? `\n      ${failures.join('\n      ')}` : ''),
  );
}

writeFileSync(join(OUT, '_summary.json'), JSON.stringify(results, null, 2));

const failed = results.filter(r => r.failures.length > 0);
console.log(`\n${results.length} scenarios, ${results.length - failed.length} passed, ${failed.length} failed, ${totalFailures} assertion failures.`);
if (failed.length) {
  console.log('Failing scenarios: ' + failed.map(r => r.name).join(', '));
  process.exitCode = 1;
}
