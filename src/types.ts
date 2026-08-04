export interface Child {
  id: string;
  name: string;
  dob: string;
}

export interface Executor {
  name: string;
  address: string;
}

/**
 * How a second executor acts, when one is named.
 *
 * 'joint'      — acts together with the first executor from the outset.
 * 'substitute' — acts only if the first executor cannot or will not.
 *
 * The clause used to read "to be Executor jointly with or as a substitute for
 * the above" — both at once, which is a construction dispute waiting for
 * probate. The will has to say which; only the person making it knows.
 * Empty is the state of every draft saved before the question existed, and it
 * blocks finalisation rather than being guessed.
 */
export type SecondExecutorRole = 'joint' | 'substitute' | '';

/**
 * Where a guardian sits in the appointment.
 *
 * 'primary'    — appointed on death, jointly with every other primary.
 * 'substitute' — appointed only if NO primary is able and willing to act.
 *
 * The two-tier split exists because the screen used to show a numbered list —
 * "Guardian 1", "Guardian 2" — while the will joined them with "and". Anyone
 * who read that list as first-choice-then-backup got something else entirely:
 * a joint appointment of all of them. Ordering that people can see has to mean
 * what it looks like it means.
 *
 * Substitutes deliberately wait for ALL primaries to fail rather than any one
 * of them. Couples are appointed together, and if one of a couple dies the
 * other should carry on alone rather than suddenly share the children with
 * whoever was named as the fallback.
 */
export type GuardianRole = 'primary' | 'substitute';

export interface Guardian {
  id: string;
  name: string;
  address: string;
  role: GuardianRole;
}

/*
 * Parental responsibility is deliberately NOT a field.
 *
 * Only a parent with it — or a guardian or special guardian — can appoint a
 * guardian at all (Children Act 1989, s.5(3)–(4)); from anyone else the
 * appointment is void. That was briefly modelled as a required yes/no/unsure
 * question, and it was the wrong shape: it blocked the step for everyone in
 * order to catch the small minority who lack it, and a self-assessed answer to
 * a question about legal status is not reliable enough to key clause-generation
 * off. It is now an explanatory note on the Guardians screen instead — the
 * people it applies to are told plainly, and nobody else is stopped.
 */

/**
 * Where a specific gift goes if its recipient dies before the testator.
 *
 * 'residue'     — it falls into and forms part of the residuary estate (default).
 * 'named'       — it passes to one or more named people, who take JOINTLY. A
 *                 specific gift is usually one indivisible thing, so — unlike a
 *                 residuary share — the alternatives are not given percentages;
 *                 they share the gift between them.
 * 'per-stirpes' — it passes to the recipient's own children, then down to their
 *                 issue (Wills Act 1837 s.33 machinery, stated expressly).
 *                 Offered only when the gift has a SINGLE recipient: with joint
 *                 recipients "the recipient's children" has no referent (whose
 *                 children?), so the option is withheld and refused — see
 *                 `blockingProblems`.
 */
export type GiftSubstitutionType = 'residue' | 'named' | 'per-stirpes';

/**
 * Who bears the inheritance tax attributable to a specific gift.
 *
 * 'bearsOwnTax' — the recipient bears it: the gift is reduced by the tax on it.
 * 'freeOfTax'   — the residuary estate bears it as a testamentary expense
 *                 (IHTA 1984 s.211). Note that this grosses the tax up, and if
 *                 residue is exhausted the gift abates anyway (IHTA 1984 s.37;
 *                 AEA 1925 s.34(3) and First Schedule).
 *
 * Older saved drafts predate this field — treat `undefined` as 'bearsOwnTax',
 * which is the safer default because it leaves residue intact.
 */
export type GiftTaxBurden = 'bearsOwnTax' | 'freeOfTax';

/**
 * One alternative recipient of a specific gift. Mirrors {@link Substitute} minus
 * `share`: named alternatives to a specific gift take it JOINTLY, not in
 * percentages, because the gift is usually one indivisible thing. `address` is
 * the same cheap disambiguator it is everywhere else, and optional for the same
 * reason — the substitution may never operate.
 */
export interface GiftSubstitute {
  id: string;
  name: string;
  address: string;
}

/**
 * One primary recipient of a specific gift. Structurally identical to
 * {@link GiftSubstitute} — a name and an optional address — but a different
 * role, so it is a distinct type rather than a reuse.
 *
 * `recipients` is a list because a gift can be given to several people jointly:
 * "my wedding ring to Jacob and Keira". Joint recipients take with survivorship
 * — if one dies before the testator the other(s) take the whole gift, and the
 * substitution (residue / named / per-stirpes) operates only if NONE of them
 * survive. That mirrors how the named ALTERNATIVES already behave, so the two
 * halves of the gift read the same way.
 */
export interface GiftRecipient {
  id: string;
  name: string;
  address: string;
}

export interface SpecificGift {
  id: string;

  /**
   * Who receives the gift. A list because a gift can be given to several people
   * JOINTLY, who take with survivorship (see {@link GiftRecipient}). Replaces
   * the old single `recipient` string, which is migrated into a one-entry list
   * on load.
   */
  recipients: GiftRecipient[];

  description: string;
  isCharity: boolean;
  taxBurden: GiftTaxBurden;
  substitutionType: GiftSubstitutionType;

  /**
   * The named alternatives, used only when `substitutionType === 'named'`. They
   * take the gift jointly. Replaces the old single `substitutionRecipient`
   * string, which is migrated into a one-entry list on load.
   */
  substitutionRecipients: GiftSubstitute[];

  /**
   * Where a named alternative's part goes if that alternative ALSO dies first —
   * to the other alternatives then into residue ('survivors'), or to that
   * alternative's own children ('issue'). Same semantics as a residuary
   * substitute's fallback; defaults to 'survivors', which is what the clause
   * always did.
   */
  substitutionFallback: NamedSubstituteFallback;
}

/**
 * Where a residuary share goes if that beneficiary dies before the testator.
 *
 * 'per-stirpes'  — to that beneficiary's own children, then down to their issue.
 * 'named'        — to people or charities you name, in shares you set.
 * 'pro-rata'     — split among the surviving residuary beneficiaries.
 * 'own-children' — to the TESTATOR's children, as a class.
 *
 * 'own-children' exists because the commonest will in England and Wales could
 * not be written here. "Everything to my wife, and if she goes first, to the
 * children equally" had to be built out of 'per-stirpes', which puts *my wife's*
 * children into the document rather than *my* children. Where the children are
 * the couple's own that lands on the right people by coincidence. Where either
 * partner has children from an earlier relationship it gives the whole estate to
 * the wrong family, and neither the screen nor the will said so — the preview
 * read "their own children", which is accurate and reads straight past as "ours".
 *
 * It is drafted as a class gift — "such of my children as shall survive me" —
 * and not as a list of names, so a child born after the will is signed is
 * included without the will having to be rewritten. The names are already in the
 * document: the declaration as to family recites each child with a date of
 * birth, which is where a reader checks them. Naming them in the operative words
 * as well would invite the argument that the class was confined to the children
 * alive on the day of signing, which is the opposite of the point.
 *
 * Offered only where the beneficiary is not one of the testator's own children.
 * For a gift to your own child, 'per-stirpes' already means your grandchildren;
 * 'own-children' there would say in one breath that a predeceased child's
 * children take (per stirpes) and do not take (s.33 disapplied). That
 * combination is refused rather than drafted around — see `blockingProblems`.
 */
export type SubstitutionType = 'per-stirpes' | 'named' | 'pro-rata' | 'own-children';

/**
 * One person who takes a slice of a beneficiary's share if that beneficiary
 * dies first.
 *
 * `share` is a percentage OF THAT BENEFICIARY'S SHARE, not of the estate. Two
 * substitutes on 50% each behind a partner left 60% take 30% of the estate
 * apiece. This is the single most misreadable number in the app, so the screen
 * reads the estate figure back in words next to the box, and the will itself
 * says "as to 50% thereof" — "thereof" being the word that ties it to the share
 * rather than to the whole.
 */
export interface Substitute {
  id: string;
  name: string;
  share: string;

  /**
   * Optional. Everyone else the will hands money to is identified by more than
   * a bare name — the family declaration recites the partner and children, an
   * executor and a guardian each carry an address — but a substitute used to be
   * a name floating free, and "John Smith" is not a person, it is a search. An
   * address is the cheapest disambiguator there is. Optional rather than
   * required because the substitution may never operate at all, and blocking a
   * will over the address of someone who will probably never inherit is the
   * wrong trade.
   */
  address: string;
}

/**
 * Where a named substitute's part goes if the substitute ALSO dies first.
 *
 * 'survivors' — to the other named substitutes, and if none of them survive,
 *               to the other surviving residuary beneficiaries. This is what
 *               the clause always did, so it is what every saved draft keeps.
 * 'issue'     — to that substitute's own children, equally (per stirpes);
 *               only if they leave no children does the part fall back to the
 *               survivors route.
 *
 * The option exists because "to my friend, and if she goes first, to her kids"
 * is a perfectly ordinary wish that previously could not be said: the app
 * silently rerouted a dead substitute's part sideways to people the testator
 * may never have intended to couple together.
 */
export type NamedSubstituteFallback = 'survivors' | 'issue';

/**
 * Where a beneficiary's share goes if they die first.
 *
 * `substitutes` is a list rather than one name because the commonest thing
 * anyone wants to say — "everything to my partner, and if she goes first, split
 * between the children" — could not be said unless those children happened to
 * be hers. 'own-children' covers the case where they are all mine; a list of
 * named people covers everyone else: stepchildren, a partner's children, a
 * sibling and a charity, any mix.
 *
 * Only meaningful when `type` is 'named'. It is left populated when the type is
 * switched away and back, because a substitution is a decision someone made and
 * flipping through the other options to read what they do should not silently
 * destroy it.
 *
 * The previous shape was a single `namedPerson: string`, which is why the list
 * is normalised on load rather than assumed — see `normalizeSubstitution`. That
 * field admitted "Jacob and Keira in equal shares" as free text: it dropped
 * straight into the operative words as a sentence, read perfectly well, and
 * nothing checked that the shares summed or said what happened if one of the
 * two died first. Structured, all three are answerable.
 */
export interface BeneficiarySubstitution {
  type: SubstitutionType;
  substitutes: Substitute[];
  /** Only meaningful when `type` is 'named' — see NamedSubstituteFallback. */
  namedFallback: NamedSubstituteFallback;
}

export interface Beneficiary {
  id: string;
  name: string;
  relationship: string;
  percentage: string;
  isOwnChild: boolean;
  isMinor: boolean;

  /**
   * Whether this residuary beneficiary is a charity or other organisation
   * rather than a person.
   *
   * Without it the survivorship machinery wrote family law onto a company:
   * "Cancer Research UK's share shall pass in equal shares to Cancer Research
   * UK's children then living". A charity does not survive or predecease
   * anyone — it ceases to exist or amalgamates — so every clause about this
   * beneficiary has to be worded for the right kind of recipient.
   */
  isCharity: boolean;

  substitution: BeneficiarySubstitution;

  /**
   * The person on the Family step this beneficiary *is*, or '' if the name was
   * typed by hand.
   *
   * The check for a child left out of the will used to compare the name on the
   * Family step against the names in the residuary list, character for
   * character. That is not a test of whether someone was provided for, it is a
   * test of whether they were typed identically twice: "Oliver James Smith" and
   * "Oliver Smith" are one child to everyone except the comparison. It cried
   * wolf on wills that were perfectly fine, which is the worse direction — a
   * review screen that is wrong often enough gets scrolled past, and then the
   * one warning that mattered goes with it.
   *
   * Holding the identity instead of the spelling makes the two screens agree by
   * construction. It also means a correction on either screen is a correction on
   * both, rather than a way to silently break the link.
   *
   * Empty for every draft saved before the picker existed, and for anyone added
   * through "someone else" — those still fall back to matching on the name, so
   * nothing that used to be caught stops being caught.
   */
  linkedPersonId: string;
}

export type MaritalStatus = 'single' | 'married' | 'civilPartnership' | 'divorced' | 'widowed' | '';
export type BurialPreference = 'burial' | 'cremation' | 'noPreference' | '';

export interface WillData {
  /**
   * Whether this will is being filled in on behalf of someone else.
   *
   * It changes nothing in the document — a will is always written in the
   * testator's own voice, and it is always the testator who has to sign it.
   * What it changes is the wording on screen, and the warning shown on the way
   * in: a will prepared by someone who stands to benefit under it is the
   * classic set of facts for a challenge on knowledge and approval or undue
   * influence, so the person doing the typing needs to be told that.
   */
  isForSomeoneElse: boolean;

  fullName: string;
  address: string;
  dob: string;
  maritalStatus: MaritalStatus;

  partnerName: string;
  partnerAddress: string;
  children: Child[];

  /**
   * That the list of children above has been read back and confirmed complete.
   *
   * Every other check in this app compares one screen against another — a child
   * on the Family step with no share on the residuary step, a spouse named but
   * not provided for. A child who was never typed in at all is outside all of
   * it: there is nothing to compare against, and the will reads as consistent
   * and complete right up to the point it is read out.
   *
   * That omission is the most expensive mistake this app can help someone make.
   * An adult child left out of a parent's will is the standard claim under the
   * Inheritance (Provision for Family and Dependants) Act 1975, brought against
   * an estate with nobody left to say what was meant. The people most likely to
   * make it are the ones the hint above does not reach: a child from an earlier
   * relationship, an estranged child, an adult child who is doing fine and did
   * not come to mind.
   *
   * So it is stored, not merely displayed — a record that the question was put
   * and answered, surviving a close and reopen. Old drafts default to false:
   * being asked once more costs a tap, assuming an answer nobody gave is the
   * failure being fixed.
   */
  childrenConfirmed: boolean;

  primaryExecutor: Executor;
  secondaryExecutor: Executor;
  /** Required once a second executor is named — see SecondExecutorRole. */
  secondaryExecutorRole: SecondExecutorRole;
  backupExecutor: Executor;

  guardians: Guardian[];

  specificGifts: SpecificGift[];

  beneficiaries: Beneficiary[];
  ultimateBackstop: string;

  funeralWishes: string;
  burialPreference: BurialPreference;

  /**
   * Made in expectation of marriage or civil partnership.
   *
   * Marriage or civil partnership REVOKES an existing will (Wills Act 1837
   * s.18 / s.18B) — silently, in its entirety. The one escape is a will made
   * in expectation of that particular marriage which says it is not to be
   * revoked by it (s.18(3)). The expectation must be of marriage to a
   * particular person, which is why the name is required when the answer is
   * yes: "whoever I happen to marry" does not engage the saving.
   */
  expectingMarriage: boolean;
  intendedSpouseName: string;
}

export const EMPTY_WILL: WillData = {
  isForSomeoneElse: false,
  fullName: '',
  address: '',
  dob: '',
  maritalStatus: '',
  partnerName: '',
  partnerAddress: '',
  children: [],
  childrenConfirmed: false,
  primaryExecutor: { name: '', address: '' },
  secondaryExecutor: { name: '', address: '' },
  secondaryExecutorRole: '',
  backupExecutor: { name: '', address: '' },
  guardians: [],
  specificGifts: [],
  beneficiaries: [],
  ultimateBackstop: '',
  funeralWishes: '',
  burialPreference: '',
  expectingMarriage: false,
  intendedSpouseName: '',
};
