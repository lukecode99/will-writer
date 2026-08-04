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
    check: all(
      noMarkers,
      documentSays(
        // s.15 as extended by the Civil Partnership Act 2004 — a beneficiary's
        // civil partner witnessing voids the gift just as a spouse does, so the
        // signing-line label has to say so.
        'must not be a beneficiary or the spouse or civil partner of a beneficiary',
        // The sweep-up backstop is conditioned on the PART failing, not the
        // whole estate — one surviving beneficiary elsewhere must not block it
        // while a failed branch falls into intestacy.
        'If and so far as any part of my residuary estate is not effectively disposed of by the foregoing provisions of this clause, that part shall pass to the British Heart Foundation',
      ),
    ),
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
    check: all(
      noMarkers,
      // The trust's deemed-failure limb must route through the substitution
      // provisions rather than granting the trustees a dispositive discretion.
      // Two needles because the sentence straddles a page break in this
      // fixture, and the page footer interrupts a single one.
      documentSays('their share shall pass as if that beneficiary'),
      documentSays('had failed to survive me by 30 days, in accordance with the substitution provisions set out above.'),
      advisoryDoesNotMention('have not appointed a guardian'),
      // This fixture flags Oliver as a minor and leaves Amelia, born 2019,
      // unflagged. That was there before the switch was checked against
      // anything and went unremarked; now it is the mixed case, and it is
      // asserted here so the wording stays the softer of the two — the trust
      // clause exists and its operative words already cover her.
      advisoryMentions('Amelia Smith'),
      advisoryMentions('they are not named in it'),
    ),
  },

  'minors-no-guardians': {
    // Not a blocker: leaving guardians out is a lawful choice. It is a warning,
    // and the app now says out loud what happens if you make it.
    verdict: 'ok',
    mustNotContain: ['APPOINTMENT OF GUARDIANS', 'DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryMentions('have not appointed a guardian')),
  },

  /*
   * The "this beneficiary is under 18" switch, checked against the rest of the
   * will. Four scenarios, because the switch is wrong in more than one way and
   * the app must not say the same sentence about all of them.
   *
   * The spouse case is the one Luke hit while testing: married and under 18
   * cannot both be true, since the minimum age for marriage and civil
   * partnership in England and Wales has been 18 since 27 February 2023, so the
   * app says one of the two answers is wrong. The cohabitant case is the
   * control — an unmarried partner under 18 is unusual but possible, and calling
   * that impossible would be a new bug rather than a fix, so the expectation
   * asserts the impossibility wording is absent there.
   */
  'spouse-marked-minor': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('married or in a civil partnership under 18'),
      advisoryMentions('Jane Elizabeth Smith'),
    ),
  },

  'cohabitant-marked-minor': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('held by your executors on trust until they turn 18'),
      advisoryDoesNotMention('married or in a civil partnership under 18'),
    ),
  },

  // Born 2004 on the Family step, switched on as a minor on the residuary step.
  // The date of birth already answers it, so the advisory reports it back
  // rather than asking the question again.
  'adult-child-marked-minor': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('which they already have'),
      advisoryDoesNotMention('married or in a civil partnership under 18'),
    ),
  },

  // The other direction, and the one with teeth: young children, neither switch
  // set, so the document carries no trust for a minor beneficiary at all. The
  // absent clause is asserted directly as well as through the advisory, because
  // the advisory's wording is only correct if the clause really is missing.
  'young-children-none-flagged': {
    verdict: 'ok',
    mustNotContain: ['TRUSTS FOR MINOR BENEFICIARIES', 'DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('no trust for a young beneficiary at all'),
      advisoryMentions('cannot give your executors a valid receipt'),
    ),
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
        // The substitute takes on the same 30-day condition as every other
        // taker, and the branch closes its own gap rather than lapsing into
        // partial intestacy if the substitute dies too.
        "Oliver Smith's share shall pass to Michael Doyle, provided that Michael Doyle survives me by 30 days",
        'and if Michael Doyle shall not so survive me, that share shall be divided among the other surviving residuary beneficiaries',
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
    // Blocked, not warned. It used to be a warning on the theory the Family
    // screen could not be passed without answering — but the Review Edit links
    // and a resumed old draft reach generation without crossing that screen's
    // Continue button, and a child left out of a will is the most expensive
    // omission this app can help someone make. The draft's problems page must
    // tell the user this is what is holding the document back — the phrase
    // appears there as advice, never as a term of the will.
    verdict: 'REFUSED',
    problemsMention: ['not confirmed that every one of your children is listed'],
    mustContain: ['DRAFT — DO NOT SIGN'],
    check: documentSays('You have not confirmed that every one of your children is listed'),
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
    // A substitute with nobody to substitute for appoints no one, while
    // reading on screen as though it appoints someone. Promoting them to first
    // choice would be the app quietly deciding who raises the children, so
    // this now blocks — a warning beside a Continue button is bypassed by the
    // Review Edit links and a resumed draft, which is how it reached
    // generation in the first place.
    verdict: 'REFUSED',
    problemsMention: ['substitute guardian but no first choice'],
    mustContain: ['DRAFT — DO NOT SIGN'],
    mustNotContain: ['APPOINTMENT OF GUARDIANS', 'Deborah Clark'],
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
    ],
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    // The baseline answers the role question as 'substitute', so the second
    // appointment is conditional rather than "I also appoint".
    check: all(noMarkers, documentSays('unable or unwilling to act, I appoint Sarah Hughes')),
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

  // ── "Everything to my partner, then my children" ──────────────────────────

  /**
   * The commonest will in England and Wales.
   *
   * Two things are being pinned. The operative words must describe the class —
   * "such of my children as shall survive me" — and not name anybody, because a
   * list of names excludes a child born after signing. And the review screen
   * must not claim the children were left out: they are provided for by the
   * substitution, which is the whole shape of this will. That warning fired on
   * every correctly-built mirror will until now, on the same screen that is
   * supposed to catch a child who really was omitted.
   */
  'mirror-will': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        "Jane Elizabeth Smith's share shall pass in equal shares to such of my children as shall survive me by 30 days",
        'if no child or issue of mine shall so survive me',
      ),
      // The per-stirpes wording gives the estate to Jane's children. If it
      // appears here the two branches have been confused, which is the failure
      // this option exists to prevent.
      documentDoesNotSay("such of Jane Elizabeth Smith's children"),
      // No section 33 recital: it is about a gift to a child of mine, and Jane
      // is not one.
      documentDoesNotSay('section 33 of the Wills Act 1837 shall not apply'),
      advisoryDoesNotMention('not left anything in this will'),
    ),
  },

  /**
   * The same will with the old approximation, kept as the contrast.
   *
   * Nothing in the data says whether Jane's children are also John's — that is
   * exactly why the wording has to be distinguishable on the page. This fixture
   * fails if the two substitutions ever start producing the same sentence, and
   * it asserts that the omitted-children warning *does* still fire here, because
   * on this drafting the children genuinely take nothing.
   */
  'mirror-will-per-stirpes': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      // Both limbs key to the same 30-day window as the gift itself — the old
      // "children then living" left a child who outlived the beneficiary but
      // died before the testator in neither limb.
      documentSays(
        "shall pass in equal shares to such of Jane Elizabeth Smith's children as shall survive me by 30 days",
        'died in my lifetime or failed to survive me by 30 days',
      ),
      documentDoesNotSay('such of my children as shall survive me'),
      advisoryMentions('not left anything in this will'),
    ),
  },

  /**
   * A gift to an empty class. Unreachable from the screen, which hides the
   * option when there are no children — and reachable by choosing it and then
   * deleting them two screens away, where nothing shows the consequence.
   */
  'own-children-no-children': {
    verdict: 'REFUSED',
    problemsMention: ['no children are listed on Partner & Children'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * The one combination that contradicts itself inside a single sentence: a
   * predeceased child's children taking per stirpes while s.33 is disapplied so
   * that they do not. Refused rather than drafted around.
   */
  'own-children-on-own-child': {
    verdict: 'REFUSED',
    problemsMention: ['cannot be used as the substitute'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * Being named as the person who takes if someone else dies first is a
   * provision. Neither child takes anything directly here — Oliver is the
   * substitute for the residue, Amelia for the specific gift — and the review
   * screen reported both of them as left out of the will.
   *
   * Two rules, one assertion: it fails if either substitute stops counting.
   */
  'named-substitutes': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, advisoryDoesNotMention('not left anything in this will')),
  },

  /**
   * A child who exists on the residuary screen and not on the family one.
   *
   * Warned rather than refused, and deliberately not repaired on the user's
   * behalf: copying the beneficiary into the family details would invent a
   * child out of a switch, and clearing the switch would disinherit one.
   *
   * The guardian sentence is asserted separately from the list sentence. A
   * warning that named the missing list but not the consequence would satisfy a
   * single loose assertion while saying nothing about the half that cannot be
   * put right afterwards — `hasMinorChildren` reads `data.children` and nothing
   * else, so an empty list means the guardians step never appears and the
   * existing no-guardian warning cannot fire either.
   */
  'child-only-on-residuary': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('marked as your child on the residuary step'),
      advisoryMentions('no guardian has been appointed and you have not been asked for one'),
    ),
  },

  /**
   * A child row started and not finished. Refused, because the alternative is a
   * signable will with a gap marker in the middle of a sentence.
   *
   * `noMarkers` cannot catch this one: it only inspects documents the app
   * agreed to finalise, and the entire defect was that this one was finalised.
   * The mutation check is what pins it — remove the guard and the verdict turns
   * 'ok', at which point noMarkers fires on [CHILD NAME MISSING].
   */
  'child-row-unfinished': {
    verdict: 'REFUSED',
    problemsMention: ['has no name'],
    mustContain: ['DRAFT — DO NOT SIGN'],
    // The rest of the list still reads back correctly in the draft preview,
    // which is how someone finds the row they left blank.
    check: documentSays('Oliver Smith (born 1 June 2004)', 'Amelia Smith (born 12 September 2006)'),
  },

  /**
   * Everything to the partner, and behind her a list of people chosen
   * individually — the provision the app could not express at all before.
   *
   * Three things are asserted, and each is a different way the clause could be
   * right-looking and wrong.
   *
   * The apportionment must say "thereof". Without it, "50% to Oliver Smith"
   * inside a clause about Jane's share is ambiguous between half of her share
   * and half of the estate, and a reader resolving it the wrong way is not
   * making an unreasonable mistake.
   *
   * The cross-accruer sentence must be there. A list of substitutes with no gift
   * over is the hole the list itself opens: one of the three dies first, their
   * part is caught by nothing, and it drops into partial intestacy while every
   * other clause works perfectly.
   *
   * And no advisory may suggest the class gift. Two of these three are the
   * testator's children but Daniel Doyle is not, so "my children equally" would
   * disinherit him — a suggestion that fired here would be advice to break the
   * will. This is the assertion that makes the advisory's precision load-bearing
   * rather than incidental.
   */
  'substitutes-per-primary': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        'as to 50% thereof to Oliver Smith',
        'as to 30% thereof to Amelia Smith',
        'as to 20% thereof to Daniel Doyle',
        "that person's part shall pass to such of the others of them as shall so survive me",
        // And the branch closes its own gap: if every substitute fails, the
        // share goes to the other surviving residuary beneficiaries rather
        // than lapsing into partial intestacy.
        'and if none of them shall so survive me',
      ),
      advisoryDoesNotMention('not left anything in this will'),
      advisoryDoesNotMention('are exactly your children'),
    ),
  },

  /**
   * Substitute shares coming to 80% of the share they are shares of.
   *
   * Refused rather than warned. The will reads as complete — every clause is
   * well-formed and the residuary percentages themselves total 100 — and it is
   * silent about a fifth of the estate on that branch. Nothing downstream would
   * notice, which is the definition of the failure this app cannot afford.
   */
  'substitutes-share-short': {
    verdict: 'REFUSED',
    problemsMention: ['share out 80%'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /** A substitute row with no name in it — same class as the unnamed child. */
  'substitutes-blank-name': {
    verdict: 'REFUSED',
    problemsMention: ['has no name'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * Every child named individually and nobody else.
   *
   * Valid, so it generates — and advised, because the two provisions differ only
   * in a future nobody is thinking about while filling in the form. A class gift
   * picks up a child born after signing; this list cannot, and nobody rewrites a
   * will for a reason they do not know exists.
   */
  'substitutes-are-my-children': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      advisoryMentions('are exactly your children'),
      advisoryMentions('covers a child born after you sign'),
    ),
  },

  // ── Round 6: fixes from the 01-Aug-2026 regression audit ─────────────────

  /**
   * Wills Act 1837 s.18(3) / s.18B(3). Marriage or civil partnership revokes a
   * will silently and in its entirety; the saving clause must name the
   * particular person and say the will is to survive that marriage.
   */
  'expectation-of-marriage': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        'I make this Will in expectation of my forthcoming marriage to, or civil partnership with, Samantha Carter, and I intend that this Will shall not be revoked by that marriage or civil partnership.',
      ),
    ),
  },

  /** "Whoever I marry" does not engage s.18(3), so the name is required. */
  'expectation-of-marriage-unnamed': {
    verdict: 'REFUSED',
    problemsMention: ['did not name the person you expect to marry'],
    mustContain: ['DRAFT — DO NOT SIGN'],
    check: documentDoesNotSay('in expectation of my forthcoming marriage'),
  },

  /**
   * The age gate used to run only when something was typed — the one person
   * who skipped the question skipped the gate, and the will went out with no
   * date of birth to identify the testator.
   */
  'dob-blank': {
    verdict: 'REFUSED',
    problemsMention: ['date of birth is missing'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  'marital-status-missing': {
    verdict: 'REFUSED',
    problemsMention: ['marital status is missing'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * A charity taking residue. Every clause about it must be worded for an
   * organisation: it ceases to exist or amalgamates, it has no children, and
   * its share is never held on trust until it turns 18.
   */
  'charity-residuary': {
    verdict: 'ok',
    mustContain: ['• Cancer Research UK (a registered charity) — 50%'],
    mustNotContain: ['DRAFT — DO NOT SIGN', 'TRUSTS FOR MINOR BENEFICIARIES'],
    check: all(
      noMarkers,
      documentSays(
        'If Cancer Research UK (50%) shall have ceased to exist or amalgamated with another charity or body at my death',
      ),
      documentDoesNotSay(
        "Cancer Research UK's children",
        'Cancer Research UK (50%) shall fail to survive me by 30 days',
      ),
    ),
  },

  /**
   * A charity with every person-shaped answer set on it. All three
   * contradictions block — each would put family law onto a company in the
   * operative words of a signed document.
   */
  'charity-person-answers': {
    verdict: 'REFUSED',
    problemsMention: [
      'marked both as a charity and as your own child',
      'marked both as a charity and as under 18',
      'so its share cannot pass to',
    ],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * The second executor question, answered each way. The clause used to say
   * "jointly with or as a substitute for the above" — both at once, a
   * construction dispute decided at probate when the one person who knew is
   * dead.
   */
  'executor-role-joint': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays('to be Executor of this my Will jointly with the said Robert Hughes'),
      documentDoesNotSay('unable or unwilling to act, I appoint Sarah Hughes'),
    ),
  },

  /** Unanswered — the state of every draft saved before the question existed. */
  'executor-role-missing': {
    verdict: 'REFUSED',
    problemsMention: ['acts jointly with your first executor or only as a substitute'],
    mustContain: ['DRAFT — DO NOT SIGN'],
    check: documentSays('[JOINTLY WITH OR AS A SUBSTITUTE FOR THE FIRST EXECUTOR — NOT YET CHOSEN]'),
  },

  /**
   * An address typed under an empty name. The clause is only written when the
   * name is filled in, so this executor used to vanish from the document
   * without a word of complaint.
   */
  'executor-address-no-name': {
    verdict: 'REFUSED',
    problemsMention: ['address for a second executor but no name'],
    mustContain: ['DRAFT — DO NOT SIGN'],
    check: documentDoesNotSay('9 Birch Way'),
  },

  /** A guardian row started and never named, with minor children in the will. */
  'guardian-unnamed': {
    verdict: 'REFUSED',
    problemsMention: ['One of your guardians has no name'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * A child's date of birth that is not a date. Empty is allowed — the
   * declaration simply names the child — but a typo must not silently drop
   * the identifying detail the user believed they had provided.
   */
  'child-dob-garbage': {
    verdict: 'REFUSED',
    problemsMention: ['date of birth for Oliver Smith is not a real date'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /** "If Rita fails to survive me, this gift shall pass to Rita." */
  'gift-substitute-self': {
    verdict: 'REFUSED',
    problemsMention: ['same person as the recipient'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /** A gift over to the recipient's own children, per stirpes, then residue. */
  'gift-per-stirpes': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        "shall pass in equal shares to such of Michael Doyle's children as shall survive me by 30 days",
        "those grandchildren shall take their parent's share equally between them (per stirpes)",
        'if no child or issue of Michael Doyle shall so survive me, this gift shall fall into and form part of my residuary estate',
      ),
    ),
  },

  /** Two named alternatives taking one gift jointly, then residue. */
  'gift-joint-named': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        'this gift shall pass to Amelia Smith and Bob Jones of 4 Elm Road, Leeds, LS1 2AB jointly',
        'if any of them shall fail to survive me by 30 days, this gift shall pass to such of them as shall so survive me',
        'if none of them shall so survive me, this gift shall fall into and form part of my residuary estate',
      ),
      // The address rides the first mention only — it must not repeat.
      ({ shown }) => (flatten(shown).match(/4 Elm Road, Leeds, LS1 2AB/g) || []).length > 1
        ? ['the substitute address repeats on a later mention'] : [],
    ),
  },

  /** One named alternative whose part passes to their own children, then residue. */
  'gift-named-issue': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        'this gift shall pass to Amelia Smith, provided that Amelia Smith survives me by 30 days',
        'those children shall take this gift equally between them (per stirpes)',
        'and if Amelia Smith shall not so survive me and shall leave no such children, this gift shall fall into and form part of my residuary estate',
      ),
    ),
  },

  /** Two people take one gift jointly, with survivorship; alternative only if none survive. */
  'gift-joint-primary': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(
      noMarkers,
      documentSays(
        'I give my 1968 Gibson guitar to Michael Doyle and Sarah Doyle of 9 Oak Lane, York, YO1 7AB, or to such of them as shall survive me by 30 days, jointly, absolutely',
        'If none of them shall survive me by 30 days, this gift shall pass to Amelia Smith',
      ),
      // The address rides the first mention only — it must not repeat.
      ({ shown }) => (flatten(shown).match(/9 Oak Lane, York, YO1 7AB/g) || []).length > 1
        ? ['the recipient address repeats on a later mention'] : [],
    ),
  },

  /** "Their own children take it" with two recipients — whose children? Refused. */
  'gift-joint-primary-per-stirpes': {
    verdict: 'REFUSED',
    problemsMention: ['more than one recipient'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /** The residuary version of the same nothing-clause. */
  'residuary-self-substitute': {
    verdict: 'REFUSED',
    problemsMention: ['is Jane Elizabeth Smith themselves'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * A 185-character unbroken name. The wrapper must break the token rather
   * than centre a line that starts hundreds of points off the left edge —
   * text drawn at negative x exists in the PDF but can never be seen.
   */
  'long-unbroken-name': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: all(noMarkers, ({ strict, draft }) => {
      const rendered = strict.status === 'ok' ? strict : draft;
      const out = [];
      for (const r of rendered.records) {
        if (typeof r.x === 'number' && r.x < 0) {
          out.push(`text drawn off the left edge at x=${r.x.toFixed(1)}: ${JSON.stringify(String(r.text).slice(0, 40))}`);
          break;
        }
      }
      return out;
    }),
  },

  /**
   * A sole residuary beneficiary who chose "pro-rata among the survivors" — the
   * share is to be split among the others, and there is no other. The clause
   * would send the residue to an empty class and lapse into intestacy in silence.
   * The screen greys the option out when there is no one to share to; this is the
   * backstop that catches it if it is reached anyway on a saved draft.
   */
  'pro-rata-sole': {
    verdict: 'REFUSED',
    problemsMention: ['no other beneficiaries with a share to divide it among'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * A residuary beneficiary whose "what happens if they die first?" is still
   * unchosen. The app no longer guesses a default, so the will must be refused
   * until the user picks — and the draft must mark the gap rather than dispose
   * of the share on a branch nobody chose. The marker is asserted against a
   * whitespace-normalised copy of the document because it word-wraps in the PDF.
   */
  'residuary-substitution-unchosen': {
    verdict: 'REFUSED',
    problemsMention: ["have not chosen what happens to Jane Elizabeth Smith's share"],
    mustContain: ['DRAFT — DO NOT SIGN'],
    check: ({ shown }) =>
      shown.replace(/\s+/g, ' ').includes('NO SUBSTITUTION CHOSEN for Jane Elizabeth Smith')
        ? []
        : ['draft does not mark the unchosen residuary substitution'],
  },

  /**
   * The same for a specific gift left unchosen: refused until the user says
   * where the gift goes if the recipient dies first, with the draft marking it.
   */
  'gift-substitution-unchosen': {
    verdict: 'REFUSED',
    problemsMention: ['have not chosen what happens to the gift to Michael Doyle'],
    mustContain: ['DRAFT — DO NOT SIGN'],
    check: ({ shown }) =>
      shown.replace(/\s+/g, ' ').includes('NO CHOICE MADE for what happens to this gift')
        ? []
        : ['draft does not mark the unchosen gift substitution'],
  },

  /**
   * round 9 — married without naming the spouse. The declaration would read
   * "I am married." without saying to whom, so generation is refused rather
   * than producing that ambiguous statement.
   */
  'married-no-partner-name': {
    verdict: 'REFUSED',
    problemsMention: ['said you are married but did not name your spouse'],
    mustContain: ['DRAFT — DO NOT SIGN'],
  },

  /**
   * round 9 — an emoji in the advisory funeral wishes. It is stripped on the
   * PDF and raised as a warning; it must NOT block the will (as an unprintable
   * character in a name would), and the finished document must still render.
   */
  'funeral-wishes-emoji': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: ({ advisories }) =>
      advisories.some(w => w.step === 'funeral' && w.message.includes('cannot be printed and will be left out'))
        ? []
        : ['no warning raised for the unprintable character in funeral wishes'],
  },

  /**
   * round 9 — a gift marked as a charity but with two recipients. The will
   * words it "(each a registered charity)". Legitimate for two genuine
   * charities, so it generates, but it WARNS so the user confirms each named
   * recipient really is a charity before signing.
   */
  'gift-charity-multi-recipient': {
    verdict: 'ok',
    mustNotContain: ['DRAFT — DO NOT SIGN'],
    check: ({ advisories }) =>
      advisories.some(w => w.step === 'gifts' && w.message.includes('describes each of them as a registered charity'))
        ? []
        : ['no warning raised for the multi-recipient charity gift'],
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
