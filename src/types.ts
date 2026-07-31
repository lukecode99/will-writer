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

export type GiftSubstitutionType = 'residue' | 'named';

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

export interface SpecificGift {
  id: string;
  recipient: string;
  description: string;
  isCharity: boolean;
  taxBurden: GiftTaxBurden;
  substitutionType: GiftSubstitutionType;
  substitutionRecipient: string;
}

export type SubstitutionType = 'per-stirpes' | 'named' | 'pro-rata';

export interface BeneficiarySubstitution {
  type: SubstitutionType;
  namedPerson: string;
}

export interface Beneficiary {
  id: string;
  name: string;
  relationship: string;
  percentage: string;
  isOwnChild: boolean;
  isMinor: boolean;
  substitution: BeneficiarySubstitution;
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

  primaryExecutor: Executor;
  secondaryExecutor: Executor;
  backupExecutor: Executor;

  guardians: Guardian[];

  specificGifts: SpecificGift[];

  beneficiaries: Beneficiary[];
  ultimateBackstop: string;

  funeralWishes: string;
  burialPreference: BurialPreference;
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
  primaryExecutor: { name: '', address: '' },
  secondaryExecutor: { name: '', address: '' },
  backupExecutor: { name: '', address: '' },
  guardians: [],
  specificGifts: [],
  beneficiaries: [],
  ultimateBackstop: '',
  funeralWishes: '',
  burialPreference: '',
};
