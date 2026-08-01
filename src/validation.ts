import { WillData } from './types';
import { unprintableChars } from './text';
import { parseUkDate, ageInYears, hasMinorChildren, todayUtc } from './family';
import { PARTNER_REF, childRef, knownRefs } from './people';

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

  // A child row with no name in it.
  //
  // The declaration as to family prints every child by name, so a blank row was
  // being finalised as "I have 3 children living at the date of this Will,
  // namely Oliver Smith (born 1 June 2004), Amelia Smith (born 12 September
  // 2006), [CHILD NAME MISSING]." — a signable will with a gap marker in the
  // middle of a sentence, produced without a word of complaint. Every other gap
  // marker in this document is blocked before finalisation; this one was
  // reached by a row someone started and did not finish, which is the likeliest
  // way of all to arrive at one.
  //
  // The unnamed beneficiary check directly below has said the same thing about
  // shares since the beginning. This is that check, for the other list.
  const unnamedChildren = data.children.filter(c => !c.name.trim()).length;
  if (unnamedChildren > 0) {
    problems.push({
      step: 'family',
      message: unnamedChildren === 1
        ? 'One of your children has no name. Add it, or remove the row.'
        : `${unnamedChildren} of your children have no name. Add them, or remove the rows.`,
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

      // "My children equally" with no children is a gift to an empty class: the
      // share is left to nobody and drops through to the backstop, or to
      // intestacy if there isn't one. The option is hidden when there are no
      // children, so this is only reachable by choosing it and then removing
      // them — which is exactly the edit whose consequence is invisible from the
      // residuary screen.
      if (b.substitution.type === 'own-children' && data.children.length === 0) {
        problems.push({
          step: 'residuary',
          message: `You chose "my children equally" as the substitute for ${b.name.trim() || 'a beneficiary'}, but no children are listed on Partner & Children. Add them, or choose a different substitute.`,
        });
      }

      // The one combination that would contradict itself in a single sentence.
      // For a gift to your own child the clause says a predeceased child's
      // children take per stirpes, while section 33 has to be disapplied to
      // reach the other children at all — so the same grandchildren both take
      // and do not take. Not draftable, so not drafted.
      if (b.substitution.type === 'own-children' && b.isOwnChild) {
        problems.push({
          step: 'residuary',
          message: `${b.name.trim() || 'This beneficiary'} is your own child, so "my children equally" cannot be used as the substitute — it would say your grandchildren both do and do not inherit. Choose "their children equally" instead, which for your own child already means your grandchildren.`,
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

  // A guardian appointment that appoints nobody. The document still reads as
  // complete, so it has to be said out loud on Review rather than left to be
  // discovered when it is relied on.
  if (hasMinorChildren(data) && data.guardians.length > 0 && !data.guardians.some(g => g.role === 'primary')) {
    out.push({
      step: 'guardians',
      message: 'You named a substitute guardian but no first choice. A substitute only takes over from someone, so as it stands no guardian is appointed.',
    });
  }

  // A gift to the testator's own child where the chosen substitution displaces
  // Wills Act 1837 s.33 — the grandchildren take nothing.
  //
  // This was already flagged, but only in a box on the residuary screen, next to
  // the option that caused it. That is the right place to say it first and the
  // wrong place to say it only: it is on screen at the moment of the choice and
  // gone by the time anyone reviews what they have made. Review is the last page
  // before signing and the one place the whole will is looked at together, so a
  // consequence this size has to survive to it.
  //
  // Named individually. "One of your children" would be true and useless — with
  // three children and one changed option, the user needs to know which.
  const s33Overridden = data.beneficiaries
    .filter(b => b.isOwnChild && b.substitution.type !== 'per-stirpes')
    .map(b => b.name.trim())
    .filter(Boolean);
  if (s33Overridden.length > 0) {
    out.push({
      step: 'residuary',
      message: `If ${s33Overridden.join(' or ')} died before you, their share would not go to their own children. By law it normally would (Wills Act 1837, section 33), and the option you chose overrides that. Your will now says so in terms. If you have grandchildren through ${s33Overridden.length === 1 ? 'them' : 'either of them'}, check this is what you meant.`,
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

  // The Family step will not let anyone past without confirming the list of
  // children is complete, so this should be unreachable by anyone filling the
  // will in from the start.
  //
  // It is here for the drafts that were saved before the question existed. They
  // reopen unconfirmed, at whatever step they were left on, which may be well
  // past this one — and the person resuming has no reason to walk backwards
  // through steps they already finished. Review is the one screen they are
  // guaranteed to see.
  if (!data.childrenConfirmed) {
    out.push({
      step: 'family',
      message: data.children.length === 0
        ? 'You have not listed any children, and have not confirmed that is right. Go back to Partner & Children and check.'
        : 'You have not confirmed that every one of your children is listed. Go back to Partner & Children and check — a child left out can apply to the court for provision from your estate.',
    });
  }

  // A child who exists on one screen and not the other.
  //
  // The Family step can be passed by ticking "I confirm I have no children",
  // and the residuary step then lets a beneficiary be flagged as your own
  // child. Nothing compared the two, so a will could say in one clause that
  // the testator has no children and in the next that a beneficiary is one.
  //
  // The share itself works, which is why this warns rather than blocks. What
  // does not work is the guardian: `hasMinorChildren` reads `data.children` and
  // nothing else, so an empty family list means the guardians step never
  // appears, no appointment is asked for, and the existing "you have children
  // under 18 and have not appointed a guardian" warning cannot fire either.
  // Every other omission in a will can be argued about afterwards; who looks
  // after a young child is the one that cannot, because by then the person who
  // knew the answer is dead and the court decides instead.
  //
  // Deliberately not repaired on the user's behalf. Copying the beneficiary
  // into the family details would invent a child out of a switch; clearing the
  // switch would disinherit one. Both are worse than saying so and letting the
  // person who knows which it is decide. That is the standing rule for this
  // app: warn on a contradiction, never resolve it silently.
  const childBeneficiaries = data.beneficiaries.filter(b => b.isOwnChild);
  if (data.children.length === 0 && childBeneficiaries.length > 0) {
    const names = childBeneficiaries.map(b => b.name.trim()).filter(Boolean);
    const who = names.length > 0 ? names.join(', ') : 'One of your beneficiaries';
    const plural = childBeneficiaries.length > 1;
    const minors = childBeneficiaries.filter(b => b.isMinor).map(b => b.name.trim()).filter(Boolean);
    const guardianNote = minors.length > 0
      ? ` ${minors.join(', ')} ${minors.length > 1 ? 'are' : 'is'} also marked as under 18, so no guardian has been appointed and you have not been asked for one — if that is right, add them above and you will be.`
      : '';
    out.push({
      step: 'family',
      message: `${who} ${plural ? 'are' : 'is'} marked as your ${plural ? 'children' : 'child'} on the residuary step, but no children are listed on Partner & Children. Add them there — that list is what the rest of the will works from.${guardianNote}`,
    });
  }

  // Who is provided for, established two ways.
  //
  // By link first: anyone picked from the family details on the residuary step
  // carries a reference to the person they are, so the answer does not depend on
  // the name being spelled the same way in two places. That was the original
  // mechanism and it was never a test of provision — "Oliver James Smith" on one
  // screen and "Oliver Smith" on the other is one child, and reporting him as
  // disinherited is not a small error. A review screen that is wrong on wills
  // that are fine teaches people to scroll past it.
  //
  // By name second, and it stays: a will typed out before the picker existed has
  // no links, and neither does anyone added through "someone else". Nothing that
  // used to be caught stops being caught.
  //
  // Substitutes count. Being named as the person who takes a share if someone
  // else dies first is a provision, and it is how the commonest will in England
  // and Wales provides for the children: everything to the spouse, and to the
  // children only if the spouse goes first. Counting only the primary gift
  // reported every one of those wills as leaving the children nothing, on the
  // same review screen that is supposed to catch a child who really was left
  // out. A warning that fires on the standard case is worse than no warning —
  // it is the reason the real one gets scrolled past.
  const providedFor = new Set(
    [
      ...data.beneficiaries.map(b => b.name),
      ...data.beneficiaries.map(b => b.substitution.namedPerson),
      ...data.specificGifts.map(g => g.recipient),
      ...data.specificGifts.map(g => g.substitutionRecipient),
    ].map(name => name.trim().toLowerCase()).filter(Boolean),
  );

  /**
   * Whether every child is covered as a class by a "my children equally"
   * substitution somewhere in the residuary estate.
   *
   * This one cannot be answered per child by name, because the clause never
   * names anybody — it gives to "such of my children as shall survive me",
   * which by construction includes all of them, including any born after the
   * will is signed.
   */
  const childrenTakeAsClass = data.beneficiaries.some(b => b.substitution.type === 'own-children');
  const linkedRefs = new Set(data.beneficiaries.map(b => b.linkedPersonId).filter(Boolean));
  // A spouse or civil partner left out entirely. This was missing while the
  // equivalent check for children was present, which is the wrong way round:
  // under the Inheritance (Provision for Family and Dependants) Act 1975 a
  // surviving spouse is judged on the far more generous "reasonable in all the
  // circumstances" standard, not the maintenance standard applied to an adult
  // child, so of the two they are the likelier claim, not the less likely.
  //
  // Separation does not change this. The marriage ends on decree absolute or
  // final order and nothing short of it, so someone who has been apart from
  // their spouse for years — and who is often the person most surprised by
  // this — is exactly who needs telling.
  const partner = data.partnerName.trim();
  const marriedNow = data.maritalStatus === 'married' || data.maritalStatus === 'civilPartnership';
  if (marriedNow && partner && !linkedRefs.has(PARTNER_REF) && !providedFor.has(partner.toLowerCase())) {
    out.push({
      step: 'residuary',
      message: `${partner} is your ${data.maritalStatus === 'married' ? 'spouse' : 'civil partner'} and is not left anything in this will. You are allowed to do that, but a spouse or civil partner has the strongest claim of anyone under the Inheritance (Provision for Family and Dependants) Act 1975 — and staying separated without divorcing does not change it. If this is deliberate, take advice on recording why.`,
    });
  }

  const omitted = childrenTakeAsClass ? [] : data.children
    .filter(child => !linkedRefs.has(childRef(child.id)))
    .map(child => child.name.trim())
    .filter(name => name && !providedFor.has(name.toLowerCase()));
  if (omitted.length > 0) {
    out.push({
      step: 'residuary',
      message: `${omitted.join(', ')} ${omitted.length === 1 ? 'is' : 'are'} not left anything in this will. That is allowed, but leaving a child out can be challenged — say so deliberately rather than by accident.`,
    });
  }

  // The same person entered twice.
  //
  // The picker cannot produce this — a person leaves the list the moment they
  // are chosen — but "someone else" is free text, and typing a name that is
  // already there splits one person's share across two entries. It reads as
  // two beneficiaries and pays out as two, so the arithmetic still comes to
  // 100% and nothing else notices.
  //
  // A warning rather than a block, because two people genuinely can share a
  // name: a father and a son, most obviously, which is exactly the family where
  // it is most likely to be deliberate.
  const firstSpelling = new Map<string, string>();
  const duplicated: string[] = [];
  data.beneficiaries.forEach(b => {
    const name = b.name.trim();
    if (!name) return;
    const key = name.toLowerCase();
    const seen = firstSpelling.get(key);
    if (seen === undefined) {
      firstSpelling.set(key, name);
    } else if (!duplicated.includes(seen)) {
      duplicated.push(seen);
    }
  });
  if (duplicated.length > 0) {
    out.push({
      step: 'residuary',
      message: `${duplicated.join(', ')} ${duplicated.length === 1 ? 'appears' : 'appear'} more than once in your list of beneficiaries. If that is the same person twice, combine them into one entry with one share — if they really are two different people with the same name, add something to tell them apart.`,
    });
  }

  // A beneficiary picked from the family details whose person has since been
  // removed there.
  //
  // Nothing is changed on their behalf: the share stands and the name stands.
  // Removing someone from the family details is not an instruction to disinherit
  // them, and acting on it as though it were would be an app rewriting a will
  // off the back of an edit made on a different screen. It is said out loud
  // because the two screens now disagree, and only the user can say which one is
  // right.
  const liveRefs = knownRefs(data);
  const orphaned = data.beneficiaries
    .filter(b => b.linkedPersonId && !liveRefs.has(b.linkedPersonId))
    .map(b => b.name.trim() || 'One of your beneficiaries');
  if (orphaned.length > 0) {
    out.push({
      step: 'residuary',
      message: `${orphaned.join(', ')} ${orphaned.length === 1 ? 'is' : 'are'} still left a share but no longer ${orphaned.length === 1 ? 'appears' : 'appear'} in your family details. Nothing has been changed — check which of the two is right.`,
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
