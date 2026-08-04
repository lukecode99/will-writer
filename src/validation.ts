import { Beneficiary, WillData } from './types';
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
    { step: 'family', label: 'the name of the person you expect to marry', value: data.intendedSpouseName },
  ];
  data.children.forEach(child => {
    fields.push({ step: 'family', label: `the name of your child "${child.name}"`, value: child.name });
  });
  data.guardians.forEach(guardian => {
    fields.push({ step: 'guardians', label: `the guardian "${guardian.name}"`, value: guardian.name });
    fields.push({ step: 'guardians', label: `the address for guardian "${guardian.name}"`, value: guardian.address });
  });
  data.specificGifts.forEach(gift => {
    const giftLabel = gift.recipients.map(r => r.name).filter(n => n.trim()).join(' and ');
    gift.recipients.forEach(r => {
      fields.push({ step: 'gifts', label: `the recipient "${r.name}"`, value: r.name });
    });
    fields.push({ step: 'gifts', label: `the gift "${gift.description}"`, value: gift.description });
    gift.substitutionRecipients.forEach(s => {
      fields.push({ step: 'gifts', label: `the alternative recipient "${s.name}" for "${giftLabel}"`, value: s.name });
    });
  });
  data.beneficiaries.forEach(b => {
    fields.push({ step: 'residuary', label: `the beneficiary "${b.name}"`, value: b.name });
    fields.push({ step: 'residuary', label: `the relationship for "${b.name}"`, value: b.relationship });
    b.substitution.substitutes.forEach(s => {
      fields.push({ step: 'residuary', label: `the substitute "${s.name}" for "${b.name}"`, value: s.name });
    });
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
  //
  // An EMPTY date of birth blocks too. It used to pass silently — the check
  // only ran when something was typed — which meant the age gate applied to
  // everyone except the person who skipped the question, and the one field
  // that separates the testator from a namesake was simply absent from the
  // document. A draft resumed past the first screen, or left via a Review
  // Edit link, arrived here with the field untouched.
  const dob = parseUkDate(data.dob);
  if (!data.dob.trim()) {
    problems.push({
      step: 'about',
      message: 'Your date of birth is missing. It identifies you in the will and confirms you are old enough to make one.',
    });
  } else if (!dob) {
    problems.push({ step: 'about', message: 'Your date of birth is not a real date. Enter it as DD/MM/YYYY.' });
  } else if (dob.getTime() > todayUtc().getTime()) {
    problems.push({ step: 'about', message: 'Your date of birth is in the future.' });
  } else if (ageInYears(dob) < 18) {
    problems.push({
      step: 'about',
      message: 'You must be 18 or over to make a will in England and Wales (Wills Act 1837, section 7).',
    });
  } else if (ageInYears(dob) > 120) {
    problems.push({ step: 'about', message: 'Your date of birth makes you more than 120 years old. Please check the year.' });
  }

  // The declaration as to family is built from this answer, and so is the
  // disinherited-spouse warning below — with no status there is no family
  // clause at all and the 1975 Act safety net cannot fire. It also decides
  // whether a partner is recited as a spouse, a civil partner or not at all,
  // which is not a blank the document can carry.
  if (!data.maritalStatus) {
    problems.push({ step: 'about', message: 'Your marital status is missing. The will has to state your family position.' });
  }

  // s.18(3) Wills Act 1837: a will survives a subsequent marriage only if it
  // was made in expectation of marriage to a PARTICULAR person and says so.
  // "Whoever I marry" does not engage the saving, so the name is required.
  if (data.expectingMarriage && !data.intendedSpouseName.trim()) {
    problems.push({
      step: 'family',
      message: 'You said this will is made in expectation of marriage, but did not name the person you expect to marry. The law only preserves a will made in expectation of a particular marriage.',
    });
  }

  if (!data.primaryExecutor.name.trim()) {
    problems.push({
      step: 'executors',
      message: 'No executor is named. Someone has to be appointed to carry out the will.',
    });
  }

  // An address with nobody at it. The clause is only written when the NAME is
  // filled in, so an address typed under an empty name silently vanished from
  // the document — an executor someone thought they had appointed.
  if (!data.secondaryExecutor.name.trim() && data.secondaryExecutor.address.trim()) {
    problems.push({
      step: 'executors',
      message: 'You gave an address for a second executor but no name. Add the name, or remove the address.',
    });
  }
  if (!data.backupExecutor.name.trim() && data.backupExecutor.address.trim()) {
    problems.push({
      step: 'executors',
      message: 'You gave an address for a backup executor but no name. Add the name, or remove the address.',
    });
  }

  // Joint or substitute — the will has to say which. "Jointly with or as a
  // substitute for the above" was both at once, which is a construction
  // dispute at probate, decided when the one person who knew is dead.
  if (data.secondaryExecutor.name.trim() && !data.secondaryExecutorRole) {
    problems.push({
      step: 'executors',
      message: `Say whether ${data.secondaryExecutor.name.trim()} acts jointly with your first executor or only as a substitute. The will must state which.`,
    });
  }

  // Both rules lived only on the Guardians screen's Continue button, which the
  // Review Edit links and a resumed draft walk straight past. A blank name
  // printed "[GUARDIAN NAME MISSING]" into a signable will; a substitute with
  // no primary appointed nobody while reading as though it appointed someone.
  const unnamedGuardians = data.guardians.filter(g => !g.name.trim()).length;
  if (unnamedGuardians > 0) {
    problems.push({
      step: 'guardians',
      message: unnamedGuardians === 1
        ? 'One of your guardians has no name. Add it, or remove the row.'
        : `${unnamedGuardians} of your guardians have no name. Add them, or remove the rows.`,
    });
  }
  if (data.guardians.length > 0 && !data.guardians.some(g => g.role === 'primary')) {
    problems.push({
      step: 'guardians',
      message: 'You named a substitute guardian but no first choice. A substitute only takes over from someone, so as it stands no guardian is appointed. Add a first-choice guardian, or remove the substitute.',
    });
  }

  // A child's date of birth that is not a date. Empty is allowed — the
  // declaration simply names the child without one — but "99/99/9999" is a
  // typo, and the declaration was silently dropping the identifying detail
  // the user believed they had provided.
  data.children.forEach(child => {
    const raw = (child.dob || '').trim();
    if (!raw) return;
    const parsed = parseUkDate(raw);
    const who = child.name.trim() || 'one of your children';
    if (!parsed) {
      problems.push({ step: 'family', message: `The date of birth for ${who} is not a real date. Enter it as DD/MM/YYYY, or leave it blank.` });
    } else if (parsed.getTime() > todayUtc().getTime()) {
      problems.push({ step: 'family', message: `The date of birth for ${who} is in the future.` });
    }
  });

  // The children question must actually have been answered. It was a warning,
  // on the theory the Family screen could not be passed without it — but the
  // Review Edit links and a resumed old draft both reach generation without
  // ever crossing that screen's Continue button. A child left out of a will
  // is the most expensive omission this app can help someone make, so the
  // confirmation is part of the gate, not advice beside it.
  if (!data.childrenConfirmed) {
    problems.push({
      step: 'family',
      message: data.children.length === 0
        ? 'You have not confirmed whether you have children. Go to Partner & Children and confirm the list is complete.'
        : 'You have not confirmed that every one of your children is listed. Go to Partner & Children and confirm — a child left out can apply to the court for provision from your estate.',
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
      // Named substitutes: who they are, and how much each of them takes.
      //
      // All three checks below block rather than warn, and for the same reason
      // the equivalent checks on the beneficiaries themselves do: each one ends
      // as a gap marker or a wrong number in the operative words of a signed
      // document. The shares are the addition to watch — they are a percentage
      // of this beneficiary's share, so they have to come to 100 among
      // themselves and not to the beneficiary's own figure. Someone reading
      // "60%" at the top of the card and typing 30 and 30 underneath it has
      // written a will that disposes of 36% of their estate on that branch and
      // is silent about the rest.
      if (b.substitution.type === 'named') {
        const who = b.name.trim() || 'a beneficiary';
        const subs = b.substitution.substitutes;

        if (subs.length === 0) {
          problems.push({
            step: 'residuary',
            message: `You chose named substitutes for ${who} but did not say who.`,
          });
        } else {
          const blank = subs.filter(s => !s.name.trim()).length;
          if (blank > 0) {
            problems.push({
              step: 'residuary',
              message: blank === 1
                ? `One of the substitutes for ${who} has no name. Add it, or remove the row.`
                : `${blank} of the substitutes for ${who} have no name. Add them, or remove the rows.`,
            });
          }

          // A substitute who is the beneficiary themselves: "if Alice fails to
          // survive me, her share shall pass to Alice" disposes of nothing.
          const selfSub = subs.some(
            s => s.name.trim() && s.name.trim().toLowerCase() === b.name.trim().toLowerCase(),
          );
          if (selfSub) {
            problems.push({
              step: 'residuary',
              message: `One of the substitutes for ${who} is ${who} themselves. A substitute only matters if ${who} has died — name someone else.`,
            });
          }

          // A single substitute takes the whole share, and the will says so
          // without apportioning anything, so the box is not shown and there is
          // nothing here to check.
          if (subs.length > 1) {
            const badShare = subs.filter(s => parsePercentage(s.share) === null);
            if (badShare.length > 0) {
              problems.push({
                step: 'residuary',
                message: `Check the shares for the substitutes for ${who} — each must be a number between 0 and 100.`,
              });
            } else {
              const subTotal = subs.reduce((sum, s) => sum + (parsePercentage(s.share) ?? 0), 0);
              if (Math.abs(subTotal - 100) > PERCENT_TOLERANCE) {
                problems.push({
                  step: 'residuary',
                  message: `The substitutes for ${who} share out ${Number(subTotal.toFixed(2))}% of ${b.name.trim() ? `${b.name.trim()}'s` : 'their'} share. They must come to 100% of it — these are shares of that share, not of your whole estate.`,
                });
              }
            }
          }
        }
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

      // A charity is an organisation, and three of the person-shaped answers
      // contradict that on the face of the document: it cannot be the
      // testator's child, cannot be under 18, and has no children for a
      // per-stirpes substitution to give the share to. Each combination
      // would put family law onto a company in the operative words, so each
      // is refused rather than drafted around.
      if (b.isCharity) {
        const who = b.name.trim() || 'a beneficiary';
        if (b.isOwnChild) {
          problems.push({
            step: 'residuary',
            message: `${who} is marked both as a charity and as your own child. One of those answers is wrong.`,
          });
        }
        if (b.isMinor) {
          problems.push({
            step: 'residuary',
            message: `${who} is marked both as a charity and as under 18. One of those answers is wrong.`,
          });
        }
        if (b.substitution.type === 'per-stirpes') {
          problems.push({
            step: 'residuary',
            message: `${who} is a charity, so its share cannot pass to "their children" if it ceases to exist. Choose where the share goes instead — a named substitute, the other beneficiaries, or your own children.`,
          });
        }
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

      // Pro-rata among the survivors has nothing to divide when there is no other
      // beneficiary holding a share: the clause would send this share to a class
      // with no members, so it drops through to the backstop or to intestacy in
      // silence. The option is greyed out on the screen when there are no others,
      // so this is only reachable by choosing it and then removing the other
      // beneficiaries — the edit whose consequence is invisible from here.
      if (b.substitution.type === 'pro-rata') {
        const othersWithShare = data.beneficiaries.filter(
          o => o.id !== b.id && (parsePercentage(o.percentage) ?? 0) > 0,
        );
        if (othersWithShare.length === 0) {
          problems.push({
            step: 'residuary',
            message: `You chose to divide ${b.name.trim() || 'this beneficiary'}'s share pro-rata among the other beneficiaries, but there are no other beneficiaries with a share to divide it among. Name a substitute, choose "their children", or add another beneficiary.`,
          });
        }
      }
    });
  }

  data.specificGifts.forEach(gift => {
    const namedRecipients = gift.recipients.filter(r => r.name.trim());
    const giftLabel = namedRecipients.map(r => r.name.trim()).join(' and ') || 'a recipient';
    if (namedRecipients.length === 0 || !gift.description.trim()) {
      problems.push({
        step: 'gifts',
        message: 'A specific gift is missing either the item or who receives it.',
      });
    }
    // "Their own children take it" has one referent only when there is one
    // recipient. With several joint recipients "the recipient's children" is
    // ambiguous — whose children? — so the combination is refused rather than
    // drafted into a clause nobody can construe.
    if (gift.substitutionType === 'per-stirpes' && namedRecipients.length > 1) {
      problems.push({
        step: 'gifts',
        message: `The gift to ${giftLabel} is set to pass to the recipient's own children, but it has more than one recipient. Say whose children should take it by naming an alternative, or let it fall into your residuary estate.`,
      });
    }
    if (gift.substitutionType === 'named' && !gift.substitutionRecipients.some(s => s.name.trim())) {
      problems.push({
        step: 'gifts',
        message: `You chose a named alternative for the gift to ${giftLabel} but did not say who.`,
      });
    }
    // "If Rita fails to survive me, this gift shall pass to Rita" — a clause
    // that reads as complete and does nothing at all. Checked against every
    // named alternative AND every primary recipient, since any overlap is the
    // same inoperative loop.
    if (gift.substitutionType === 'named') {
      const recipNamesLower = namedRecipients.map(r => r.name.trim().toLowerCase());
      gift.substitutionRecipients.forEach(s => {
        if (s.name.trim() && recipNamesLower.includes(s.name.trim().toLowerCase())) {
          problems.push({
            step: 'gifts',
            message: `An alternative for the gift to ${giftLabel} is the same person as the recipient. Name someone else, or let the gift fall into your residuary estate.`,
          });
        }
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
 * What is wrong, if anything, with one beneficiary's "under 18" switch.
 *
 * Exported because it is said twice on purpose: once in a box beside the switch
 * that causes it, and once on Review. The switch is where it can be understood
 * and Review is the last page before signing, and a single copy in either place
 * is the version that gets missed.
 */
export function minorFlagWarning(data: WillData, b: Beneficiary): string {
  const who = b.name.trim() || 'This beneficiary';

  if (b.isMinor && b.linkedPersonId === PARTNER_REF) {
    const spouseLabel =
      data.maritalStatus === 'married' ? 'husband or wife'
        : data.maritalStatus === 'civilPartnership' ? 'civil partner'
          : '';
    return spouseLabel
      ? `${who} is marked as under 18, and also as your ${spouseLabel}. Nobody can be married or in a civil partnership under 18 in England and Wales, so one of those two answers is wrong. As the will stands, their share is held by your executors on trust until they turn 18.`
      : `${who} is marked as under 18, so their share does not pass to them outright — it is held by your executors on trust until they turn 18. Check that is what you meant.`;
  }

  // Matched by link first and by name second, for the same reason the provision
  // check does it in that order: wills and fixtures written before the picker
  // existed carry no link, and they are exactly the ones with a hand-set switch
  // to get wrong. A name is only trusted when it matches one child, because two
  // children called the same thing is a question rather than an answer.
  const byLink = data.children.filter(c => childRef(c.id) === b.linkedPersonId);
  const name = b.name.trim().toLowerCase();
  const byName = name ? data.children.filter(c => c.name.trim().toLowerCase() === name) : [];
  const matched = byLink.length === 1 ? byLink[0] : byName.length === 1 ? byName[0] : null;
  if (!matched) return '';

  const dob = parseUkDate(matched.dob);
  if (!dob) return '';
  const age = ageInYears(dob, todayUtc());

  if (b.isMinor && age >= 18) {
    return `${who} is marked as under 18, but the date of birth on Partner & Children makes them ${age}. Their share is written as held on trust until they turn 18, which they already have.`;
  }

  if (!b.isMinor && age < 18) {
    // The severity genuinely differs. The trust clause is written to catch any
    // beneficiary who is under 18 at the date of death, so an unflagged child is
    // still covered by its operative words as long as the clause is in the
    // document at all — and it is only in the document if somebody is flagged.
    // Saying "there is no trust" when there is one would be the same class of
    // error as the switch itself.
    return data.beneficiaries.some(other => other.isMinor)
      ? `${who} is ${age} according to Partner & Children, but is not marked as under 18. The trust in your will covers any beneficiary who is under 18 when you die, so their share would still be held — but they are not named in it, and the summary shows their share as an outright gift.`
      : `${who} is ${age} according to Partner & Children, but is not marked as under 18, and neither is anyone else. Your will therefore contains no trust for a young beneficiary at all, and a person under 18 cannot give your executors a valid receipt for their share.`;
  }

  return '';
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

  // A substitute guardian with no first choice now BLOCKS generation — see
  // blockingProblems. Nothing to warn about here that the gate does not say.

  // The "this beneficiary is under 18" switch, checked against what the rest of
  // the will already says about the same person.
  //
  // Nothing checked it, and it is not a cosmetic switch: turning it on writes a
  // trust for minor beneficiaries into the document, names that person in it,
  // and prints their share in the summary as "(held on trust until age 18)".
  // Ticking it against a spouse produced a will that held the spouse's share on
  // trust until she came of age, with nothing anywhere saying so.
  //
  // Two contradictions are findable without asking for anything new, because
  // both people are already described elsewhere in the app.
  //
  // A partner is one of them. Since 27 February 2023 the minimum age for
  // marriage and civil partnership in England and Wales has been 18 (Marriage
  // and Civil Partnership (Minimum Age) Act 2022), so "my husband" and "under
  // 18" cannot both be true. An unmarried partner under 18 is at least possible,
  // so that one is reported as a consequence rather than as an error.
  //
  // A child is the other, and there the date of birth on the Family step settles
  // it. Matched by link first and by name second, for the same reason the
  // provision check does it in that order: fixtures and wills written before the
  // picker existed carry no link, and they are exactly the ones with a hand-set
  // switch to get wrong. A name is only trusted when it matches one child, since
  // two children called the same thing is a question, not an answer.
  //
  // Neither is repaired automatically. Which of the two answers is the wrong one
  // is not knowable from here, and the standing rule for this app is to warn on
  // a contradiction and never resolve it silently.
  for (const b of data.beneficiaries) {
    const message = minorFlagWarning(data, b);
    if (message) out.push({ step: 'residuary', message });
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

  // Named substitutes who are, between them, exactly the testator's own
  // children — the long way round to "my children equally", with one difference
  // that only shows up years later.
  //
  // A list of names is fixed on the day the will is signed. "Such of my children
  // as shall survive me" is a class, and a class picks up a child born
  // afterwards without the will being touched. So the two say the same thing
  // today and different things the moment there is another child, and the one
  // left out is the one who did not exist yet. Nobody rewrites a will for that,
  // because nobody knows they have to.
  //
  // Advisory, not blocking, and only raised when the named list covers every
  // child there is. Naming some of your children and not others is a decision;
  // naming all of them is nearly always someone reaching for the class gift and
  // not finding it. Not offered where the beneficiary is one of the testator's
  // own children either, because "my children equally" is refused there anyway
  // (it would say the grandchildren both do and do not take) and pointing at an
  // option that cannot be chosen is worse than saying nothing.
  const childNames = new Set(
    data.children.map(c => c.name.trim().toLowerCase()).filter(Boolean),
  );
  if (childNames.size > 1) {
    const classGiftLong = data.beneficiaries.filter(b => {
      if (b.substitution.type !== 'named' || b.isOwnChild) return false;
      const named = b.substitution.substitutes.map(s => s.name.trim().toLowerCase()).filter(Boolean);
      if (named.length !== childNames.size) return false;
      return named.every(n => childNames.has(n)) && new Set(named).size === named.length;
    }).map(b => b.name.trim()).filter(Boolean);

    if (classGiftLong.length > 0) {
      out.push({
        step: 'residuary',
        message: `The substitutes you named for ${classGiftLong.join(' and ')} are exactly your children, listed one by one. "My children equally" says the same thing today but also covers a child born after you sign this will — a named list does not, and the child who would be left out is the one who does not exist yet. If your children are the point rather than those particular names, switch to it.`,
      });
    }
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

  // An unconfirmed children list now BLOCKS generation — see blockingProblems.
  // The old warning assumed the Family screen's Continue button was the only
  // route forward; the Review Edit links proved otherwise.

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
      ...data.beneficiaries.flatMap(b => b.substitution.substitutes.map(s => s.name)),
      ...data.specificGifts.flatMap(g => g.recipients.map(r => r.name)),
      ...data.specificGifts.flatMap(g => g.substitutionRecipients.map(s => s.name)),
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
