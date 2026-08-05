import { WillData } from './types';
import type { StepKey, WillProblem } from './validation';

/**
 * The out-of-scope tripwire.
 *
 * This app writes ONE kind of will: outright gifts of an England-&-Wales estate,
 * under the Wills Act 1837, with the survivorship machinery it models
 * explicitly. It does not — and must not pretend to — create a trust, deal with
 * a business or company shareholding, dispose of property abroad, handle
 * agricultural or business property relief, tax-plan an estate, provide for a
 * disabled beneficiary without tipping them off their benefits, or attach a
 * condition to a gift.
 *
 * Those are not bugs to be fixed later; they are the edges of what a
 * fill-in-the-blanks tool can safely do. A user who types "hold on trust for
 * my son until he is 25" gets a document that says something quite different
 * from what they meant, and nothing on screen tells them so.
 *
 * So the free-text fields — the only places a user can smuggle in an intention
 * the structured questions never asked about — are scanned for the vocabulary
 * of the things this app cannot express. A match surfaces two ways, from the
 * one set of patterns below:
 *   - LIVE, inline under the field as the user types (`scopeNotesForText`), and
 *   - collected onto the Review screen (`scopeWarnings`), so a word typed on a
 *     screen the user later backs out of is still caught at the end.
 * Both follow the house rule for contradictions: say it out loud, never resolve
 * it silently, and never block on it.
 *
 * The patterns are deliberately targeted rather than greedy. This codebase has
 * a documented aversion to crying wolf — a warning that fires on wills that are
 * fine gets scrolled past, taking the one warning that mattered with it. Bare
 * "shares" is not matched (it collides with "equal shares" in ordinary
 * residuary wording); "business partner" / "civil partnership" describing a
 * person are not matched (only the business or partnership as an asset is).
 * Every category earns at most one warning per field however many times it is
 * tripped.
 */

interface ScopeCategory {
  /** Stable identifier, handy for tests and as a React key. */
  key: string;
  /** Any one match raises the category. No /g flag — these are tested, not iterated. */
  patterns: RegExp[];
  /** Review-screen wording: names the trigger word and where it was found. */
  review: (trigger: string, where: string) => string;
  /** Inline wording: shown directly under the field, so it needs no location. */
  inline: (trigger: string) => string;
}

const CATEGORIES: ScopeCategory[] = [
  {
    key: 'trust',
    patterns: [/\btrusts?\b/i, /\btrustees?\b/i],
    review: (t, w) =>
      `The word "${t}" appears in ${w}. This will makes outright gifts only — it cannot set up a trust. Anything held "in trust" (for example for a young or vulnerable person, or to control when someone inherits) needs a solicitor to draft.`,
    inline: t =>
      `"${t}" — this will makes outright gifts only and cannot set up a trust. Anything held "in trust" needs a solicitor.`,
  },
  {
    key: 'business',
    patterns: [
      /\bltd\b/i,
      /\blimited\b/i,
      /\bplc\b/i,
      /\bllp\b/i,
      /\bcompany\b/i,
      /\bshareholding\b/i,
      /\bshares? in\b/i,
      /\bsole trader\b/i,
      // A partnership as a business, not "civil partnership" (a relationship).
      /(?<!civil )\bpartnership\b/i,
      // "my business" as an asset, but not "my business partner/associate/…",
      // which is describing a person. Warn on the thing being left, not on how
      // someone is related.
      /\b(?:my|the|his|her|our|a) business\b(?!\s+(?:partner|associate|colleague|contact|acquaintance|relationship))/i,
    ],
    review: (t, w) =>
      `"${t}" in ${w} looks like a business or company interest. Passing on a business, a shareholding or a partnership interest often needs a shareholders' agreement, business property relief planning or a separate trust — none of which this will can do. Take advice before relying on it.`,
    inline: t =>
      `"${t}" — passing on a business, company shareholding or partnership interest needs specialist advice; this will cannot do it safely.`,
  },
  {
    key: 'overseas',
    patterns: [/\boverseas\b/i, /\babroad\b/i, /\bforeign\b/i],
    review: (t, w) =>
      `"${t}" in ${w} suggests property outside England & Wales. This will governs assets under the law of England & Wales only; property abroad is usually dealt with under the law where it sits, and may need a separate will. A solicitor should advise.`,
    inline: t =>
      `"${t}" — property outside England & Wales is usually governed by local law and may need a separate will. Take advice.`,
  },
  {
    key: 'agricultural',
    patterns: [/\bfarm(?:land|house|s|ing)?\b/i, /\bagricultural\b/i, /\bsmallholding\b/i],
    review: (t, w) =>
      `"${t}" in ${w} may involve a farm or agricultural land. Agricultural property has its own inheritance-tax relief and often its own succession issues; this will cannot plan for them. Take specialist advice.`,
    inline: t =>
      `"${t}" — a farm or agricultural land has its own tax reliefs and succession rules this will cannot handle. Take specialist advice.`,
  },
  {
    key: 'vulnerable',
    patterns: [/\bdisabled\b/i, /\bdisability\b/i, /\bspecial needs\b/i, /\bvulnerable\b/i, /\bmeans[- ]tested\b/i],
    review: (t, w) =>
      `"${t}" in ${w} suggests a disabled or vulnerable beneficiary. An outright gift can tip someone off means-tested benefits or care funding; the usual answer is a disabled person's trust, which this will cannot create. Please take advice before leaving a gift this way.`,
    inline: t =>
      `"${t}" — an outright gift can cost a disabled or vulnerable person their means-tested benefits. A solicitor would usually use a disabled person's trust.`,
  },
  {
    key: 'tax',
    patterns: [/\binheritance tax\b/i, /\biht\b/i, /\bnil[- ]rate band\b/i, /\btax[- ]?planning\b/i, /\btax[- ]efficient\b/i],
    review: (t, w) =>
      `"${t}" in ${w} points at inheritance-tax planning. This app writes a straightforward will and does no tax planning — no nil-rate-band trusts, gifting schemes or reliefs. If tax is a concern, see a solicitor or a tax adviser.`,
    inline: t =>
      `"${t}" — this app does no inheritance-tax planning (no nil-rate-band trusts or reliefs). If tax matters, see a solicitor or tax adviser.`,
  },
  {
    key: 'conditional',
    patterns: [
      /\bconditional\b/i,
      /\bcontingent\b/i,
      /\bon condition\b/i,
      /\bprovided that\b/i,
      /\b(?:reaches|attains|turns)\s+(?:the age|\d)/i,
      /\bwhen (?:he|she|they) (?:reach|reaches|turn|turns)\b/i,
    ],
    review: (t, w) =>
      `"${t}" in ${w} looks like a condition on a gift — inheriting only on reaching an age, or if something happens first. This will makes gifts outright and immediate; it cannot hold a gift back or attach a condition. That needs a trust, and a solicitor.`,
    inline: t =>
      `"${t}" — this will makes gifts outright and immediate; it cannot hold a gift back or attach an age or condition. That needs a trust.`,
  },
];

/**
 * Scan a single field's text and return one inline note per category tripped,
 * in category order. This is the primitive the entry screens call as the user
 * types; it is intentionally cheap and pure. Returns [] for empty or clean text.
 */
export function scopeNotesForText(text: string): { key: string; message: string }[] {
  if (!text || !text.trim()) return [];
  const notes: { key: string; message: string }[] = [];
  for (const category of CATEGORIES) {
    for (const pattern of category.patterns) {
      const m = pattern.exec(text);
      if (m) {
        notes.push({ key: category.key, message: category.inline(m[0]) });
        break;
      }
    }
  }
  return notes;
}

/** A free-text field to scan, with where it lives and how to describe it. */
interface ScannedField {
  text: string;
  step: StepKey;
  where: string;
}

function fieldsToScan(data: WillData): ScannedField[] {
  const fields: ScannedField[] = [];

  data.specificGifts.forEach(g => {
    if (g.description) fields.push({ text: g.description, step: 'gifts', where: 'one of your gifts' });
  });

  data.beneficiaries.forEach(b => {
    if (b.relationship) {
      fields.push({ text: b.relationship, step: 'residuary', where: 'how you have described a beneficiary' });
    }
  });

  if (data.ultimateBackstop) {
    fields.push({ text: data.ultimateBackstop, step: 'residuary', where: 'your backstop wording' });
  }

  if (data.funeralWishes) {
    fields.push({ text: data.funeralWishes, step: 'funeral', where: 'your funeral wishes' });
  }

  return fields;
}

/**
 * Scan the free-text fields for intentions this app cannot express, and raise
 * one non-blocking warning per category tripped. Never blocks — every problem
 * here is an advisory, appended to `warnings()`. Shares its patterns with the
 * inline `scopeNotesForText`, so the two never disagree about what is in scope.
 */
export function scopeWarnings(data: WillData): WillProblem[] {
  const fields = fieldsToScan(data);
  const out: WillProblem[] = [];

  for (const category of CATEGORIES) {
    let hit: { trigger: string; step: StepKey; where: string } | null = null;

    for (const field of fields) {
      for (const pattern of category.patterns) {
        const m = pattern.exec(field.text);
        if (m) {
          hit = { trigger: m[0], step: field.step, where: field.where };
          break;
        }
      }
      if (hit) break;
    }

    if (hit) {
      out.push({ step: hit.step, message: category.review(hit.trigger, hit.where) });
    }
  }

  return out;
}
