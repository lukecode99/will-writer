export interface Child {
  id: string;
  name: string;
  dob: string;
}

export interface Executor {
  name: string;
  address: string;
}

export interface Guardian {
  id: string;
  name: string;
  address: string;
}

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
