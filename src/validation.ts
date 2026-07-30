import { WillData } from './types';
import { unprintableChars } from './text';
import { parseUkDate, ageInYears, hasMinorChildren, todayUtc } from './family';

/**
 * Whole-document validation, in one place.
 *
 * The break-it review found the 100%-residuary check living inside
 * `ResiduaryEstate.handleNext()`, which meant any route to Review that did not
 * pass through that button — the Review "Edit" links, the Back button — skipped
 * it entirely, and `handleGenerate()` validated nothing at all. A rule that only
 * runs on one code path is not a rule. Everything that must be true of a
 * finished will is therefore asserted here and checked again at the point of
 * generation, whatever route the user took to get there.
 */

/** Steps are addressed by name; the numeric index belongs to `App` alone. */
export type StepKey =
  | 'about'
  | 'family'
  | 'executors'
  | 'guardians'
  | 'gifts'
  | 'residuary'
  | 'funeral'
  | 'review';

export interface WillProblem {
  /** Where the user has to go to fix it. */
  step: StepKey;
  message: string;
}

/** Total percentage must land within this of 100 to allow for decimal entry. */
const PERCENT_TOLERANCE = 0.01;

/**
 * Strict percentage parsing.
 *
 * `parseFloat` reads a valid prefix and discards the rest, so "50abc" became 50
 * and "50." printed back into the operative words of the will as "50.%". A
 * percentage in a will is a share of somebody's estate; it is either an
 * unambiguous number or it is not accepted.
 */
export function parsePercentage(raw: string): number | null {
  const trimmed = (raw || '').trim().replace(/%$/, '').trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!isFinite(value) || value <= 0 || value > 100) return null;
  return value;
}

/**
 * The percentage as it should appear in the document. Only ever called with a
 * value that has already passed `parsePercentage`; trailing zeros are trimmed so
 * "33.30" reads as "33.3%".
 */
export function formatPercentage(value: number): string {
  return `${Number(value.toFixed(4))}%`;
}

export function percentageTotal(data: WillData): number {
  return data.beneficiaries.reduce((sum, b) => {
    const value = parsePercentage(b.percentage);
    return sum + (value ?? 0);
  }, 0);
}

/** Every free-text value that ends up naming a person or a thing in the document. */
function namedFields(data: WillData): Array<{ step: StepKey; label: string; value: string }> {
  const fields: Array<{ step: StepKey; label: string; value: string }> = [
    { step: 'about', label: 'your name', value: data.fullName },
    { step: 'about', label: 'your address', value: data.address },
    { step: 'family', label: "your partner's name", value: data.partnerName },
    { step: 'executors', label: 'the executor name', value: data.primaryExecutor.name },
    { step: 'executors', label: 'the executor address', value: data.primaryExecutor.address },
    { step: 'executors', label: 'the second executor name', value: data.secondaryExecutor.name },
    { step: 'executors', label: 'the second executor address', value: data.secondaryExecutor.address },
    { step: 'executors', label: 'the backup executor name', value: data.backupExecutor.name },
    { step: 'executors', label: 'the backup executor address', value: data.backupExecutor.address },
    { step: 'residuary', label: 'the backstop wording', value: data.ultimateBackstop },
    { step: 'funeral', label: 'your funeral wishes', value: data.funeralWishes },
  ];
  data.children.forEach(child => {
    fields.push({ step: 'family', label: `the name of your child "${child.name}"`, value: child.name });
  });
  data.guardians.forEach(guardian => {
    fields.push({ step: 'guardians', label: `the guardian "${guardian.name}"`, value: guardian.name });
    fields.push({ step: 'guardians', label: `the address for guardian "${guardian.name}"`, value: guardian.address });
  });
  data.specificGifts.forEach(gift => {
    fields.push({ step: 'gifts', label: `the recipient "${gift.recipient}"`, value: gift.recipient });
    fields.push({ step: 'gifts', label: `the gift "${gift.description}"`, value: gift.description });
    fields.push({ step: 'gifts', label: `the substitute for "${gift.recipient}"`, value: gift.substitutionRecipient });
  });
  data.beneficiaries.forEach(b => {
    fields.push({ step: 'residuary', label: `the beneficiary "${b.name}"`, value: b.name });
    fields.push({ step: 'residuary', label: `the relationship for "${b.name}"`, value: b.relationship });
    fields.push({ step: 'residuary', label: `the substitute for "${b.name}"`, value: b.substitution.namedPerson });
  });
  return fields;
}

/**
 * Problems that must be fixed before a will can be generated at all.
 *
 * The bar is deliberately high: an incomplete will is not a harmless draft. The
 * revocation clause is operative the moment it is signed, so a document that
 * disposes of nothing still cancels a real earlier will. Refusing to produce one
 * is the whole point.
 */
export function blockingProblems(data: WillData): WillProblem[] {
  const problems: WillProblem[] = [];

  if (!data.fullName.trim()) {
    problems.push({ step: 'about', message: 'Your full name is missing. A will must identify the person making it.' });
  }
  if (!data.address.trim()) {
    problems.push({ step: 'about', message: 'Your address is missing.' });
  }

  // Wills Act 1837 s.7 — a will made under 18 is invalid (outside the narrow
  // privileged-will exception for serving forces, which this app does not cover).
  const dob = parseUkDate(data.dob);
  if (data.dob.trim() && !dob) {
    problems.push({ step: 'about', message: 'Your date of birth is not a real date. Enter it as DD/MM/YYYY.' });
  } else if (dob) {
    if (dob.getTime() > todayUtc().getTime()) {
      problems.push({ step: 'about', message: 'Your date of birth is in the future.' });
    } else if (ageInYears(dob) < 18) {
      problems.push({
        step: 'about',
        message: 'You must be 18 or over to make a will in England and Wales (Wills Act 1837, section 7).',
      });
    }
  }

  if (!data.primaryExecutor.name.trim()) {
    problems.push({
      step: 'executors',
      message: 'No executor is named. Someone has to be appointed to carry out the will.',
    });
  }

  if (data.beneficiaries.length === 0) {
    problems.push({
      step: 'residuary',
      message: 'No one is named to receive your estate. Without this the whole estate passes under the intestacy rules instead.',
    });
  } else {
    const unnamed = data.beneficiaries.filter(b => !b.name.trim()).length;
    if (unnamed > 0) {
      problems.push({
        step: 'residuary',
        message: unnamed === 1
          ? 'One of your beneficiaries has no name.'
          : `${unnamed} of your beneficiaries have no name.`,
      });
    }

    const invalid = data.beneficiaries.filter(b => parsePercentage(b.percentage) === null);
    if (invalid.length > 0) {
      problems.push({
        step: 'residuary',
        message: `Check the share for ${invalid.map(b => b.name.trim() || 'the unnamed beneficiary').join(', ')} — it must be a number between 0 and 100.`,
      });
    } else {
      const total = percentageTotal(data);
      if (Math.abs(total - 100) > PERCENT_TOLERANCE) {
        problems.push({
          step: 'residuary',
          message: total < 100
            ? `The shares add up to ${Number(total.toFixed(2))}%. The remaining ${Number((100 - total).toFixed(2))}% would not be covered by your will.`
            : `The shares add up to ${Number(total.toFixed(2))}%. They cannot come to more than 100%.`,
        });
      }
    }

    data.beneficiaries.forEach(b => {
      if (b.substitution.type === 'named' && !b.substitution.namedPerson.trim()) {
        problems.push({
          step: 'residuary',
          message: `You chose a named substitute for ${b.name.trim() || 'a beneficiary'} but did not say who.`,
        });
      }
    });
  }

  data.specificGifts.forEach(gift => {
    if (!gift.recipient.trim() || !gift.description.trim()) {
      problems.push({
        step: 'gifts',
        message: 'A specific gift is missing either the item or who receives it.',
      });
    }
    if (gift.substitutionType === 'named' && !gift.substitutionRecipient.trim()) {
      problems.push({
        step: 'gifts',
        message: `You chose a named substitute for the gift to ${gift.recipient.trim() || 'a recipient'} but did not say who.`,
      });
    }
  });

  // Characters the PDF cannot print even after transliteration. Generating
  // anyway would put a name in the will that is not the person's name.
  const seen = new Set<string>();
  namedFields(data).forEach(field => {
    if (!field.value.trim()) return;
    const bad = unprintableChars(field.value);
    if (bad.length === 0) return;
    const key = `${field.step}:${field.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({
      step: field.step,
      message: `We cannot print ${bad.join(' ')} in ${field.label}. Please write it using the Latin alphabet — the document has to match your legal name as it will be read in England and Wales.`,
    });
  });

  return problems;
}

/**
 * Things that are legally valid but are very likely not what the user meant.
 * These never block generation — they are shown on Review and the user decides.
 */
export function warnings(data: WillData): WillProblem[] {
  const out: WillProblem[] = [];

  if (hasMinorChildren(data) && data.guardians.length === 0) {
    out.push({
      step: 'guardians',
      message: 'You have children under 18 and have not appointed a guardian. If no one is appointed, the court decides who looks after them.',
    });
  }

  if (data.guardians.length > 0 && !hasMinorChildren(data)) {
    out.push({
      step: 'guardians',
      message: 'Your will still appoints a guardian, but none of your children are under 18. Remove the guardian if it is no longer needed.',
    });
  }

  if (!data.secondaryExecutor.name.trim() && !data.backupExecutor.name.trim()) {
    out.push({
      step: 'executors',
      message: 'Only one executor is named. If they cannot act, there is no one appointed to take over.',
    });
  }

  if ((data.maritalStatus === 'married' || data.maritalStatus === 'civilPartnership') && !data.partnerName.trim()) {
    out.push({
      step: 'family',
      message: 'You said you are married or in a civil partnership but did not give your partner\'s name.',
    });
  }

  // Children who are not provided for anywhere are the classic ground for a
  // claim under the Inheritance (Provision for Family and Dependants) Act 1975.
  const providedFor = new Set(
    [
      ...data.beneficiaries.map(b => b.name),
      ...data.specificGifts.map(g => g.recipient),
    ].map(name => name.trim().toLowerCase()).filter(Boolean),
  );
  const omitted = data.children
    .map(child => child.name.trim())
    .filter(name => name && !providedFor.has(name.toLowerCase()));
  if (omitted.length > 0) {
    out.push({
      step: 'residuary',
      message: `${omitted.join(', ')} ${omitted.length === 1 ? 'is' : 'are'} not left anything in this will. That is allowed, but leaving a child out can be challenged — say so deliberately rather than by accident.`,
    });
  }

  if (!data.ultimateBackstop.trim()) {
    out.push({
      step: 'residuary',
      message: 'No backstop is set. If none of your beneficiaries outlive you, your estate would pass under the intestacy rules.',
    });
  }

  return out;
}
