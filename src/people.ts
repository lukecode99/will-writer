import { WillData } from './types';

/**
 * The people the will already knows about.
 *
 * By the time anyone reaches the residuary step they have already named their
 * partner and listed their children. Asking them to type those names again is
 * not just repetition — it is the app throwing away the only reliable thing it
 * had, which is that it already knew who these people were. Everything
 * downstream then has to guess from spelling.
 *
 * So the residuary step offers those people as a list to choose from, and a
 * choice carries a reference rather than a copy of the name.
 */

/** There is only ever one partner, so the reference does not need an id. */
export const PARTNER_REF = 'p:partner';

/**
 * Prefixed rather than using the child's own id directly. Child ids are random
 * base-36 strings, so an id of exactly 'p:partner' is not possible — but a
 * namespace that cannot collide is cheaper than reasoning about whether it can.
 */
export function childRef(childId: string): string {
  return `c:${childId}`;
}

export interface KnownPerson {
  ref: string;
  name: string;
  /** Filled into the beneficiary's relationship field when they are picked. */
  relationship: string;
  isOwnChild: boolean;
}

/**
 * The people who can be picked, in the order they were entered.
 *
 * Anyone without a name is left out: there is nothing to show on a button, and
 * a blank entry in a list of people to inherit reads as a bug.
 */
export function knownPeople(data: WillData): KnownPerson[] {
  const people: KnownPerson[] = [];

  const partner = data.partnerName.trim();
  if (partner) {
    people.push({
      ref: PARTNER_REF,
      name: partner,
      // The label follows the marital status because it ends up in the will as
      // a description of the relationship, and "spouse" is not a safe default:
      // an unmarried partner has no spousal rights and calling them a spouse in
      // the document would be a statement that is simply untrue.
      relationship:
        data.maritalStatus === 'married' ? 'spouse'
          : data.maritalStatus === 'civilPartnership' ? 'civil partner'
            : 'partner',
      isOwnChild: false,
    });
  }

  data.children.forEach(child => {
    const name = child.name.trim();
    if (!name) return;
    people.push({
      ref: childRef(child.id),
      name,
      relationship: 'child',
      isOwnChild: true,
    });
  });

  return people;
}

/**
 * Every reference the family details can currently produce, whether or not the
 * person has been named yet.
 *
 * Deliberately not the same as `knownPeople`. A child row with the name cleared
 * mid-edit is a half-typed name, not a deleted child, and telling someone their
 * beneficiary has vanished from the family details because they are part-way
 * through fixing a typo would be false. A child is gone when the row is
 * removed. A partner is gone when the name is cleared, because clearing the
 * name is the only way to remove one.
 */
export function knownRefs(data: WillData): Set<string> {
  const refs = new Set<string>();
  if (data.partnerName.trim()) refs.add(PARTNER_REF);
  data.children.forEach(child => refs.add(childRef(child.id)));
  return refs;
}

/**
 * Re-reads the name and child status of every linked beneficiary from the
 * family details, so the two screens cannot drift apart.
 *
 * This runs on every change to the will, which is why it returns the object it
 * was given when there is nothing to do: it sits in the middle of a per-
 * keystroke autosave, and handing back a new object each time would rewrite the
 * whole document to disk for a change that was not there.
 *
 * A reference that no longer resolves is left completely alone — the name that
 * was last known is kept, and the link is kept too. Both are evidence. Dropping
 * the link would destroy the only record that these two entries were ever the
 * same person, and rewriting the name would quietly change who inherits because
 * of an edit made on a different screen.
 */
export function syncLinkedBeneficiaries(data: WillData): WillData {
  if (!data.beneficiaries.some(b => b.linkedPersonId)) return data;

  const people = knownPeople(data);
  let changed = false;

  const beneficiaries = data.beneficiaries.map(b => {
    if (!b.linkedPersonId) return b;
    const person = people.find(p => p.ref === b.linkedPersonId);
    if (!person) return b;
    if (person.name === b.name && person.isOwnChild === b.isOwnChild) return b;
    changed = true;
    return { ...b, name: person.name, isOwnChild: person.isOwnChild };
  });

  return changed ? { ...data, beneficiaries } : data;
}

/**
 * What a newly-added residuary beneficiary's substitute should start as.
 *
 * The default matters more here than defaults usually do, because the
 * substitution is the part of a will people are least likely to revisit: it
 * answers a question about a death that has not happened, on a screen already
 * asking them about percentages. Whatever it starts as is what most wills will
 * say.
 *
 * So it starts as the answer that is right for most wills. "If they go first,
 * my children take" is the shape of the commonest will in England and Wales,
 * and it is right for a charity or a friend too — a charity has no children,
 * and per-stirpes for one is wording that can never operate.
 *
 * Two exceptions, both of which would otherwise produce something that cannot
 * work:
 *
 * - No children listed. A gift to an empty class, and blocked in validation.
 * - The beneficiary is one of my own children, where "my children equally"
 *   contradicts itself in a single sentence. Per-stirpes there already means my
 *   grandchildren, which is what s.33 would have done anyway.
 *
 * Only ever consulted when a beneficiary is added. A substitution already saved
 * on a draft is left exactly as it is: a default that reached back into stored
 * wills would change who inherits under a document its owner had already read.
 */
export function defaultSubstitutionType(
  isOwnChild: boolean,
  data: WillData,
): 'per-stirpes' | 'own-children' {
  return data.children.length > 0 && !isOwnChild ? 'own-children' : 'per-stirpes';
}
