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

export interface SpecificGift {
  id: string;
  recipient: string;
  description: string;
  isCharity: boolean;
}

export interface Beneficiary {
  id: string;
  name: string;
  relationship: string;
  percentage: string;
}

export type MaritalStatus = 'single' | 'married' | 'civilPartnership' | 'divorced' | 'widowed' | '';
export type BurialPreference = 'burial' | 'cremation' | 'noPreference' | '';

export interface WillData {
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
  residuaryBackup: string;

  funeralWishes: string;
  burialPreference: BurialPreference;
}

export const EMPTY_WILL: WillData = {
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
  residuaryBackup: '',
  funeralWishes: '',
  burialPreference: '',
};
