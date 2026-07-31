/* eslint-disable */
/**
 * What each scenario must produce.
 *
 * Round 1 of the audit rendered every scenario and left the judgement to me
 * reading the output. That found 19 real problems, but it does not survive
 * contact with a change made in three months' time. These are the same
 * judgements written down as assertions, so `node audit/run.mjs` either exits 0
 * or names what regressed.
 *
 * Needles are matched against the document text in layout order. Long
 * paragraphs are wrapped before they are drawn, so a needle that spans a line
 * break will never match — assertions are therefore kept to short phrases, and
 * where a phrase could straddle a wrap they are reduced to a single word (a
 * word is never split).
 *
 * Every entry additionally gets the common invariants in `commonChecks` below.
 */

const PAGE_BOTTOM = 40;

/**
 * Invariants that hold for every document the app can produce, valid or draft.
 * These are the failures that would otherwise only show up as "the last line is
 * missing" in a PDF nobody opened.
 */
function commonChecks({ shown, strict, draft }) {
  const out = [];
  const rendered = strict.status === 'ok' ? strict : draft;

  // The draft preview has to render whatever it is given. It is the only way a
  // user with an incomplete will can see what is wrong, so it must never throw.
  if (draft.status === 'THREW') {
    out.push(`draft render crashed: ${draft.error && draft.error.message}`);
  }

  // Nothing may be drawn off the bottom of the page. `ensureSpace` is supposed
  // to page-break before that happens; this is the check that it did.
  for (const r of rendered.records) {
    if (typeof r.y === 'number' && r.y < PAGE_BOTTOM) {
      out.push(`text drawn below the page at y=${r.y.toFixed(1)}: ${JSON.stringify(r.text.slice(0, 60))}`);
      break;
    }
  }

  // Every page numbered, and the totals agreeing — a will with a page missing
  // should be obvious to whoever reads it.
  const total = rendered.pages;
  for (let i = 1; i <= total; i++) {
    if (!shown.includes(`Page ${i} of ${total}`)) {
      out.push(`page ${i} of ${total} has no footer`);
    }
  }

  // Clause numbers must run 1, 2, 3 … with no gaps and no repeats. Optional
  // clauses used to be numbered by arithmetic over which sections happened to be
  // present, which is exactly how a will gets a clause 3 followed by a clause 5.
  const numbers = [];
  for (const line of shown.split('\n')) {
    const m = /^(\d+)\. [A-Z][A-Z ]/.exec(line.trim());
    if (m) numbers.push(Number(m[1]));
  }
  const expected = numbers.map((_, i) => i + 1);
  if (numbers.join(',') !== expected.join(',')) {
    out.push(`clause numbering is ${numbers.join(',') || '(none)'} — expected ${expected.join(',') || '(none)'}`);
  }

  // Placeholders that mean a value never made it to the page.
  for (const junk of ['undefined', 'NaN', '[object Object]']) {
    if (shown.includes(junk)) out.push(`document contains ${JSON.stringify(junk)}`);
  }

  return out;
}

/** Never a bracketed gap marker in a document the app agreed to finalise. */
function noMarkers({ shown, strict }) {
  if (strict.status !== 'ok') return [];
  const found = [...shown.matchAll(/\[[A-Z][A-Z '"—-]+\]/g)].map(m => m[0]);
  return found.length ? [`finalised will still contains gap markers: ${[...new Set(found)].join(', ')}`] : [];
}

/**
 * Matches the document with its line breaks flattened.
 *
 * `mustContain` compares against the text as laid out, so a needle longer than
 * one line is really an assertion about where the wrap happens to fall. Rename
 * a beneficiary three paragraphs earlier and it starts failing for a reason
 * that has nothing to do with what it was testing. The existing entries live
 * with that by keeping needles short enough to fit on a line — a rule that has
 * to be remembered every time and gives no warning at all when it is forgotten.
 *
 * The negative form is the one that actually bites: a `mustNotContain` needle
 * that straddles a line break passes, and a passing assertion is not something
 * anyone goes looking at. That is a test reporting the absence of words that
 * are right there in the document.
 *
 * So: use these wherever the phrase that matters is longer than a few words.
 * They assert what the will says, and say nothing about how it was laid out.
 */
function flatten(text) {
  return text.replace(/\s+/g, ' ');
}

function documentSays(...needles) {
  return ({ shown }) => {
    const flat = flatten(shown);
    return needles
      .filter(n => !flat.includes(flatten(n)))
      .map(n => `document does not say ${JSON.stringify(n)}`);
  };
}

function documentDoesNotSay(...needles) {
  return ({ shown }) => {
    const flat = flatten(shown);
    return needles
      .filter(n => flat.includes(flatten(n)))
      .map(n => `document says ${JSON.stringify(n)} and must not`);
  };
}

function advisoryMentions(...needles) {
  return ({ advisories }) =>
    needles
      .filter(n => !advisories.some(a => a.message.includes(n)))
      .map(n => `no warning mentions ${JSON.stringify(n)}`);
}

function advisoryDoesNotMention(...needles) {
  return ({ advisories }) =>
    needles
      .filter(n => advisories.some(a => a.message.includes(n)))
      .map(n => `unexpected warning mentioning ${JSON.stringify(n)}`);
}

function all(...checks) {
  return (arg) => checks.flatMap(c => c(arg) || []);
}

const RAW = {
  // ── The document that should just work ────────────────────────────────────
  baseline: {
    verdict: 'ok',
    mustContain: [
      'LAST WILL AND TESTAMENT',
      'of John Andrew Smith',
      '1. REVOCATION OF PRIOR WILLS',
      'born on 14 March 1985',
      '2. DECLARATION AS TO FAMILY',
      'I am married to Jane Elizabeth Smith',
      '3. APPOINTMENT OF EXECUTORS',
      '4. SPECIFIC GIFTS',
      '5. BURDEN OF INHERITANCE TAX',
      '6. RESIDUARY ESTATE',
      '7. POWERS OF MY EXECUTORS AND TRUSTEES',
      '8. FUNERAL WISHES',
      'SURVIVORSHIP AND SUBSTITUTION',
      'ATTESTATION',
      'DATE OF SIGNING',
      'SIGNING INSTRUCTIONS',
      'WHAT CAN CHANGE OR OVERRIDE THIS WILL',
      'THIS IS A TEMPLATE DOCUMENT — NOT LEGAL ADVICE',
      '• Jane Elizabeth Smith (wife) — 50%',
      '• Oliver Smith (son) — 30%',
      '• Amelia Smith (daughter) — 20%',
    ],
    mustNotContain: [
      'DRAFT — DO NOT SIGN',
      'DRAFT — THIS DOCUMENT IS INCOMPLETE',
      'APPOINTMENT OF GUARDIANS',
      'TRUSTS FOR MINOR BENEFICIARIES',
    ],
    check: noMarkers,
  },

  // ── The four fatal findings, each pinned by the case that produced it ─────
  'zero-residuary': {
    verdict: 'REFUSED',
    problemsMention: ['No one is named to receive your estate'],
    mustContain: [
      'DRAFT — DO NOT SIGN',
      'DRAFT — THIS DOCUMENT IS INCOMPLETE AND MUST NOT BE SIGNED',
      '[NO BENEFICIARIES NAMED — THIS WILL DISPOSES OF NOTHING]',
      '[NO BENEFICIARIES NAMED]',
      'DO NOT SIGN — this draft is incomplete.',
    ],
  },

  'percentages-90': {
    verdict: 'REFUSED',
    problemsMention: ['add up to 90%', 'remaining 10%'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  'percentages-110': {
    verdict: 'REFUSED',
    problemsMention: ['add up to 110%', 'cannot come to more than 100%'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  'single-beneficiary-100': {
    verdict: 'ok',
    mustContain: ['• Jane Elizabeth Smith (wife) — 100%'],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    // Both children are left out entirely — that is allowed, and is exactly the
    // 1975 Act exposure the review said had to be surfaced rather than assumed.
    check: all(noMarkers, advisoryMentions('not left anything in this will')),
  },

  // ── Guardians ─────────────────────────────────────────────────────────────
  'minors-with-guardians': {
    verdict: 'ok',
    mustContain: [
      '4. APPOINTMENT OF GUARDIANS',
      'section 5(3) of the Children Act 1989',
      'TRUSTS FOR MINOR BENEFICIARIES',
      '(held on trust until age 18)',
    ],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryDoesNotMention('have not appointed a guardian')),
  },

  'minors-no-guardians': {
    // Not a blocker: leaving guardians out is a lawful choice. It is a warning,
    // and the app now says out loud what happens if you make it.
    verdict: 'ok',
    mustNotContain: ['APPOINTMENT OF GUARDIANS', 'DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryMentions('have not appointed a guardian')),
  },

  'guardians-with-substitute': {
    // Two first choices and one substitute. The assertion that matters is the
    // last sentence: a substitute must not join a surviving primary. Appoint a
    // couple, one of them dies, and the survivor carries on alone.
    verdict: 'ok',
    mustContain: [
      'APPOINTMENT OF GUARDIANS',
      'Robert Hughes',
      'Sarah Hughes',
      'If none of the guardians appointed above is able and willing to act',
      'Deborah Clark',
      'that guardian shall act alone and this substitution shall not take effect',
    ],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  'guardians-single-plus-substitute': {
    // One first choice. The clause has to negate in the singular — the first
    // draft of this wording read "If the guardian appointed above IS able and
    // willing to act ... then I appoint the substitute", which is the exact
    // opposite of the intention, and reads plausibly enough to survive a skim.
    verdict: 'ok',
    mustContain: [
      'APPOINTMENT OF GUARDIANS',
      'If the guardian appointed above is not able and willing to act',
      'Deborah Clark',
    ],
    mustNotContain: [
      'DRAFT — DO NOT SIGN',
      'If none of the guardians appointed above',
      // The joint carve-out is meaningless with one primary, and printing it
      // would invite the reader to look for a second guardian who is not there.
      'shall act alone and this substitution shall not take effect',
    ],
    check: noMarkers,
  },

  'spouse-omitted': {
    // Lawful, so it generates. The warning is the whole point of the scenario:
    // the app used to flag an omitted child and say nothing about an omitted
    // spouse, which had it exactly backwards.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('is your spouse and is not left anything in this will'),
      // The separation point specifically. Someone who has been apart for
      // years is the likeliest person to assume the claim has lapsed.
      advisoryMentions('staying separated without divorcing does not change it'),
    ),
  },

  // ── Beneficiaries picked from the family details ──────────────────────────
  'child-name-differs-unlinked': {
    // The child is provided for. The warning fires anyway, because the only
    // thing being compared is the spelling, and "Oliver James Smith" is not
    // "Oliver Smith".
    //
    // Pinned as expected rather than fixed. This is what an entry typed by hand
    // has always done and still does, and the answer is not to loosen the match
    // — a looser match buys quiet here by starting to miss children who really
    // were left out, and that error costs someone a claim. The answer is to stop
    // asking the question by name at all, which is the next scenario.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryMentions('Oliver James Smith', 'not left anything in this will')),
  },

  'child-name-differs-linked': {
    // Same two spellings, same document, one difference: the share carries a
    // reference to the child rather than a second copy of his name. Silence.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryDoesNotMention('not left anything in this will')),
  },

  'spouse-linked-different-spelling': {
    // The link beats the name for the spouse too, not just for children. Worth
    // its own case: the spouse check is a separate code path with a separate
    // reference, and a fix that only reached the children would look right in
    // the diff and be half done.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryDoesNotMention('is your spouse and is not left anything')),
  },

  'beneficiary-named-twice': {
    // 50 + 30 + 20 = 100, so every arithmetic check passes and the will
    // generates cleanly. One person is simply written down twice and paid twice.
    // Nothing else in the app can see it.
    //
    // Different case on purpose — 'oliver smith' against 'Oliver Smith'. If the
    // duplicate check were ever made case-sensitive this scenario goes quiet,
    // which is the failure mode most likely to be introduced by accident.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryMentions('appears more than once')),
  },

  'beneficiary-link-orphaned': {
    // Oliver held a share and was then removed from the family details. Both
    // the share and the name stand: an edit on one screen is not an instruction
    // to disinherit someone on another, and an app that acted on it as though it
    // were would be rewriting a will off the back of a keystroke. The
    // disagreement is said out loud instead.
    verdict: 'ok',
    mustContain: ['• Oliver Smith (son) — 30%'],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryMentions('no longer', 'family details')),
  },

  // ── Wills Act 1837 s.33, and displacing it on purpose ─────────────────────
  'own-child-named-substitute': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        "Oliver Smith's share shall pass to Michael Doyle absolutely.",
        // The words that make the intention express rather than a matter of
        // construction, and the reason this scenario exists.
        'Oliver Smith is my child. I direct that section 33 of the Wills Act 1837 shall not apply ' +
          "to this gift, so that Oliver Smith's children shall not take Oliver Smith's share in Oliver Smith's place.",
      ),
      advisoryMentions('would not go to their own children', 'Oliver Smith'),
    ),
  },

  'own-child-pro-rata': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        "Oliver Smith's share shall be divided among the other surviving residuary beneficiaries",
        'Oliver Smith is my child. I direct that section 33 of the Wills Act 1837 shall not apply',
      ),
      advisoryMentions('would not go to their own children'),
    ),
  },

  'non-child-pro-rata': {
    // Jane is the wife, so s.33 never applied to her share, and the two
    // children keep per-stirpes — which agrees with the section rather than
    // displacing it. Nothing in this document should mention it at all.
    //
    // Reciting a statute into a will that has nothing to do with it is not
    // harmless padding. It is an invitation to whoever reads the will to work
    // out what was meant by putting it there.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentDoesNotSay('section 33', 'is my child'),
      advisoryDoesNotMention('would not go to their own children'),
    ),
  },

  // ── the list of children unconfirmed ──────────────────────────────────────
  'children-unconfirmed': {
    // Warned, not blocked, and the document itself is untouched. The
    // confirmation is a question we put to the user, not a term of the will,
    // and it has no business appearing in what they sign.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('not confirmed that every one of your children is listed'),
      documentDoesNotSay('confirmed that every one of your children'),
    ),
  },

  'divorced-spouse-not-beneficiary': {
    // The control. No subsisting marriage, no 1975 spouse claim, no warning —
    // a check that fires when it should not is worse than none, because it
    // teaches people to scroll past the review screen.
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryDoesNotMention('is your spouse and is not left anything')),
  },

  'guardians-substitute-only': {
    // A substitute with nobody to substitute for appoints no one. Promoting
    // them to first choice would be the app quietly deciding who raises the
    // children, so the clause is left out and the reason is spelled out.
    verdict: 'ok',
    mustNotContain: [
      'APPOINTMENT OF GUARDIANS',
      'Deborah Clark',
      'DRAFT — DO NOT SIGN',
    ],
    check: all(noMarkers, advisoryMentions('substitute guardian but no first choice')),
  },

  'adult-children-stale-guardians': {
    // The appointment stays in the document — it is the user's express choice and
    // deleting it silently would be worse than printing it. It is legally inert
    // once every child is 18 (Children Act 1989 s.5 reaches minors only), so the
    // right answer is to print it and warn.
    verdict: 'ok',
    mustContain: ['APPOINTMENT OF GUARDIANS'],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryMentions('none of your children are under 18')),
  },

  // ── Specific gifts ────────────────────────────────────────────────────────
  'gifts-only-no-residuary': {
    // Gifts alone do not make a will: everything not specifically given falls
    // into a residue that has nobody to take it, so it passes on intestacy while
    // the revocation clause has already cancelled the previous will.
    verdict: 'REFUSED',
    problemsMention: ['No one is named to receive your estate'],
    mustContain: ['[NO BENEFICIARIES NAMED — THIS WILL DISPOSES OF NOTHING]'],
  },

  'thirty-specific-gifts': {
    verdict: 'ok',
    mustContain: ['a) I give gift item number 1', 'z) I give gift item number 26', 'aa) I give', 'ad) I give'],
    // `String.fromCharCode(97 + i)` lettered the 27th gift "{".
    mustNotContain: ['{) I give', 'DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  'charity-named-sub-blank': {
    verdict: 'REFUSED',
    problemsMention: ['did not say who'],
    mustContain: [
      '[ALTERNATIVE RECIPIENT NAME MISSING]',
      // A charity does not fail to survive by 30 days; it ceases to exist.
      'amalgamated',
      '(a registered charity)',
    ],
  },

  'free-of-tax-and-charity': {
    verdict: 'ok',
    mustContain: [
      '5. BURDEN OF INHERITANCE TAX',
      '(a) Any gift expressed',
      '(b) Any other gift',
      '(c) If my residuary estate',
      'amalgamated',
    ],
    // The single-paragraph variant is only correct when nothing is free of tax.
    mustNotContain: ['Each specific gift made by this Will', 'DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  // ── Empty and malformed input ─────────────────────────────────────────────
  'fully-empty': {
    verdict: 'REFUSED',
    problemsMention: [
      'Your full name is missing',
      'Your address is missing',
      'No executor is named',
      'No one is named to receive your estate',
    ],
    mustContain: [
      'DRAFT — DO NOT SIGN',
      '[FULL NAME MISSING]',
      '[ADDRESS MISSING]',
      '[PRIMARY EXECUTOR NAME MISSING]',
      '[NO BENEFICIARIES NAMED — THIS WILL DISPOSES OF NOTHING]',
    ],
    // Nothing is known about the family, so the clause must be absent rather
    // than printed with holes in it.
    mustNotContain: ['DECLARATION AS TO FAMILY', 'SPECIFIC GIFTS', 'BURDEN OF INHERITANCE TAX'],
  },

  'unicode-names': {
    // CJK and emoji cannot be printed at all by the standard PDF fonts. Dropping
    // them would put a different name in the will than the one the user typed.
    verdict: 'REFUSED',
    problemsMention: ['We cannot print'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  'whitespace-address': {
    verdict: 'ok',
    mustContain: [
      'Middlesex',
      'I appoint Robert Hughes of',
      'I also appoint Sarah Hughes',
    ],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  'backstop-blank': {
    verdict: 'ok',
    mustContain: ['intestacy'],
    mustNotContain: ['British Heart Foundation', 'DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryMentions('No backstop is set')),
  },

  'backstop-vague': {
    verdict: 'ok',
    mustContain: ['cousins'],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  // ── Round 2: one scenario per fix ─────────────────────────────────────────
  'translit-name': {
    verdict: 'ok',
    mustContain: ['Michal Kowalski', 'Ingrida Berzina'],
    // The first round deleted the character instead of transliterating it, which
    // is how "Michał" became "Micha" — a different person.
    mustNotContain: ['Micha Kowalski', 'Ingrda', 'DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  'untransliterable-name': {
    verdict: 'REFUSED',
    problemsMention: ['We cannot print', 'your name'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  'under-18': {
    verdict: 'REFUSED',
    problemsMention: ['Wills Act 1837, section 7'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  'future-dob': {
    verdict: 'REFUSED',
    problemsMention: ['date of birth is in the future'],
  },

  'impossible-dob': {
    // 31/02/1985 used to roll silently to 2 March.
    verdict: 'REFUSED',
    problemsMention: ['not a real date'],
    mustNotContain: ['born on 2 March 1985', 'born on 3 March 1985'],
  },

  'iso-dob-typed': {
    verdict: 'REFUSED',
    problemsMention: ['not a real date'],
  },

  'junk-percentages': {
    verdict: 'REFUSED',
    problemsMention: ['Check the share for'],
    mustContain: ['[SHARE NOT SPECIFIED]'],
    mustNotContain: ['50abc'],
  },

  'trailing-dot-percentage': {
    verdict: 'REFUSED',
    problemsMention: ['Check the share for'],
    mustNotContain: ['50.%'],
  },

  'decimal-thirds': {
    verdict: 'ok',
    mustContain: ['33.33%', '33.34%'],
    // Floating point: 33.33 + 33.33 + 33.34 does not come to exactly 100, and
    // the share must not print its own rounding error either.
    mustNotContain: ['33.3300', '33.339999', 'DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  'named-sub-blank': {
    verdict: 'REFUSED',
    problemsMention: ['did not say who'],
    mustContain: ['[SUBSTITUTE NAME MISSING]'],
  },

  'unnamed-beneficiary': {
    verdict: 'REFUSED',
    problemsMention: ['has no name'],
    mustContain: ['[BENEFICIARY NAME MISSING]'],
  },

  'no-executor': {
    verdict: 'REFUSED',
    problemsMention: ['No executor is named'],
    mustContain: ['[PRIMARY EXECUTOR NAME MISSING]'],
  },

  'single-no-family': {
    verdict: 'ok',
    mustContain: [
      '2. DECLARATION AS TO FAMILY',
      'I am not married and I am not in a civil partnership.',
    ],
    // No children, so no children sentence at all.
    mustNotContain: ['namely', 'DRAFT — DO NOT SIGN'],
    check: noMarkers,
  },

  divorced: {
    verdict: 'ok',
    mustContain: [
      'My marriage or civil partnership has been dissolved.',
      'Divorce or dissolution changes it',
      '18A',
    ],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryDoesNotMention('married or in a civil partnership')),
  },

  'long-text': {
    verdict: 'ok',
    mustContain: ['8. FUNERAL WISHES', 'Royal National Lifeboat Institution'],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    // The point of this one is pagination: the common checks assert nothing is
    // drawn off the bottom of a page and that every page is numbered.
    check: all(noMarkers, ({ strict }) =>
      strict.pages >= 5 ? [] : [`expected the long-text will to run past 4 pages, got ${strict.pages}`]),
  },
};

// Attach the common invariants to every scenario.
const EXPECTATIONS = {};
for (const [name, spec] of Object.entries(RAW)) {
  const own = spec.check;
  EXPECTATIONS[name] = {
    ...spec,
    check: own ? all(commonChecks, own) : commonChecks,
  };
}

module.exports = { EXPECTATIONS };
