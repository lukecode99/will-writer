/* eslint-disable */
// Scenario fixtures for the will-writer audit harness.

const EMPTY = {
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

const clone = (o) => JSON.parse(JSON.stringify(o));

function ben(id, name, relationship, percentage, opts = {}) {
  return {
    id,
    name,
    relationship,
    percentage,
    isOwnChild: opts.isOwnChild || false,
    isMinor: opts.isMinor || false,
    substitution: opts.substitution || { type: 'per-stirpes', namedPerson: '' },
  };
}

function gift(id, recipient, description, opts = {}) {
  return {
    id,
    recipient,
    description,
    isCharity: opts.isCharity || false,
    taxBurden: opts.taxBurden || 'bearsOwnTax',
    substitutionType: opts.substitutionType || 'residue',
    substitutionRecipient: opts.substitutionRecipient || '',
  };
}

// ---------------------------------------------------------------- baseline
const baseline = {
  ...clone(EMPTY),
  fullName: 'John Andrew Smith',
  address: '22 Castleton Road, Ruislip, HA4 9QJ',
  dob: '14/03/1985',
  maritalStatus: 'married',
  partnerName: 'Jane Elizabeth Smith',
  partnerAddress: '22 Castleton Road, Ruislip, HA4 9QJ',
  children: [
    { id: 'c1', name: 'Oliver Smith', dob: '01/06/2004' },
    { id: 'c2', name: 'Amelia Smith', dob: '12/09/2006' },
  ],
  primaryExecutor: { name: 'Robert Hughes', address: '5 Elm Grove, Watford, WD17 1AB' },
  secondaryExecutor: { name: 'Sarah Hughes', address: '5 Elm Grove, Watford, WD17 1AB' },
  backupExecutor: { name: '', address: '' },
  specificGifts: [gift('g1', 'Michael Doyle', 'my 1968 Gibson guitar')],
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50'),
    ben('b2', 'Oliver Smith', 'son', '30', { isOwnChild: true }),
    ben('b3', 'Amelia Smith', 'daughter', '20', { isOwnChild: true }),
  ],
  ultimateBackstop: 'the British Heart Foundation',
  funeralWishes: 'A simple service with family only.',
  burialPreference: 'cremation',
};

// -------------------------------------------------- zero residuary benefs
const zeroResiduary = { ...clone(baseline), beneficiaries: [] };

// -------------------------------------------------------- percentages 90
const pct90 = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50'),
    ben('b2', 'Oliver Smith', 'son', '30', { isOwnChild: true }),
    ben('b3', 'Amelia Smith', 'daughter', '10', { isOwnChild: true }),
  ],
};

// ------------------------------------------------------- percentages 110
const pct110 = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50'),
    ben('b2', 'Oliver Smith', 'son', '30', { isOwnChild: true }),
    ben('b3', 'Amelia Smith', 'daughter', '30', { isOwnChild: true }),
  ],
};

// ------------------------------------------------------ single benef 100
const single100 = {
  ...clone(baseline),
  beneficiaries: [ben('b1', 'Jane Elizabeth Smith', 'wife', '100')],
};

// ------------------------------------ minor children + guardians appointed
const minorsWithGuardians = {
  ...clone(baseline),
  children: [
    { id: 'c1', name: 'Oliver Smith', dob: '01/06/2015' },
    { id: 'c2', name: 'Amelia Smith', dob: '12/09/2019' },
  ],
  guardians: [
    { id: 'gu1', name: 'Robert Hughes', address: '5 Elm Grove, Watford, WD17 1AB', role: 'primary' },
    { id: 'gu2', name: 'Sarah Hughes', address: '5 Elm Grove, Watford, WD17 1AB', role: 'primary' },
  ],
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50'),
    ben('b2', 'Oliver Smith', 'son', '30', { isOwnChild: true, isMinor: true }),
    ben('b3', 'Amelia Smith', 'daughter', '20', { isOwnChild: true }),
  ],
};

// ----------------------------------------- minor children, guardians EMPTY
const minorsNoGuardians = { ...clone(minorsWithGuardians), guardians: [] };

// ------------------------------- a couple as first choice, plus a substitute
// The case the old numbered list got wrong. Two primaries are appointed
// jointly; the substitute waits for BOTH to fail, not either, so that if one
// of the couple dies the survivor carries on alone.
const guardiansWithSubstitute = {
  ...clone(minorsWithGuardians),
  guardians: [
    { id: 'gu1', name: 'Robert Hughes', address: '5 Elm Grove, Watford, WD17 1AB', role: 'primary' },
    { id: 'gu2', name: 'Sarah Hughes', address: '5 Elm Grove, Watford, WD17 1AB', role: 'primary' },
    { id: 'gu3', name: 'Deborah Clark', address: '9 Ash Lane, Watford, WD18 2CD', role: 'substitute' },
  ],
};

// ------------------------------------ one first choice, one substitute
// Separate scenario because the clause is worded differently in the singular,
// and the first draft of that wording said the opposite of what it meant.
const guardiansSinglePlusSubstitute = {
  ...clone(minorsWithGuardians),
  guardians: [
    { id: 'gu1', name: 'Robert Hughes', address: '5 Elm Grove, Watford, WD17 1AB', role: 'primary' },
    { id: 'gu3', name: 'Deborah Clark', address: '9 Ash Lane, Watford, WD18 2CD', role: 'substitute' },
  ],
};

// --------------------------------------- a substitute with nobody to replace
// Appoints no one. Promoting them to first choice would change the
// appointment behind the user's back, so the document stays silent and the
// review explains why.
const guardiansSubstituteOnly = {
  ...clone(minorsWithGuardians),
  guardians: [
    { id: 'gu3', name: 'Deborah Clark', address: '9 Ash Lane, Watford, WD18 2CD', role: 'substitute' },
  ],
};

// ---------------------------------- married, spouse left out of the will
// Still married on paper, living apart, everything to the children. Lawful,
// and the single most exposed thing this app can produce: a surviving spouse
// is judged under the Inheritance (Provision for Family and Dependants) Act
// 1975 on the generous "reasonable in all the circumstances" standard.
const spouseOmitted = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Oliver Smith', 'son', '50', { isOwnChild: true }),
    ben('b2', 'Amelia Smith', 'daughter', '50', { isOwnChild: true }),
  ],
};

// ------------------------ divorced, ex-spouse named but not a beneficiary
// The control for the scenario above. The marriage has ended, so there is no
// 1975 spouse claim and the warning must NOT fire — otherwise it becomes
// noise that people learn to scroll past on the one screen where they cannot
// afford to.
const divorcedSpouseNotBeneficiary = {
  ...clone(baseline),
  maritalStatus: 'divorced',
  beneficiaries: [
    ben('b1', 'Oliver Smith', 'son', '50', { isOwnChild: true }),
    ben('b2', 'Amelia Smith', 'daughter', '50', { isOwnChild: true }),
  ],
};

// ------------------------------------ specific gifts only, no residuary
const giftsOnlyNoResiduary = {
  ...clone(baseline),
  specificGifts: [
    gift('g1', 'Michael Doyle', 'my 1968 Gibson guitar'),
    gift('g2', 'Helen Doyle', 'my mother’s pearl necklace'),
  ],
  beneficiaries: [],
};

// ------------------------------------------------------- 30 specific gifts
const thirtyGifts = {
  ...clone(baseline),
  specificGifts: Array.from({ length: 30 }, (_, i) =>
    gift('g' + (i + 1), `Recipient Number ${i + 1}`, `gift item number ${i + 1}`)
  ),
};

// -------------------- charity gift, substitutionType 'named', blank recipient
const charityNamedBlankSub = {
  ...clone(baseline),
  specificGifts: [
    gift('g1', 'Cancer Research UK', 'the sum of five thousand pounds', {
      isCharity: true,
      substitutionType: 'named',
      substitutionRecipient: '',
    }),
  ],
};

// ------------------------------------------------------------ fully empty
const fullyEmpty = clone(EMPTY);

// ---------------------------------------------------------- unicode names
const unicodeNames = {
  ...clone(baseline),
  fullName: 'Michał Kowalski',
  partnerName: 'Zoë O’Brien-Šimek',
  children: [
    { id: 'c1', name: '李明', dob: '01/06/2004' },
    { id: 'c2', name: 'Emoji Child 😀🎉', dob: '12/09/2006' },
  ],
  primaryExecutor: { name: 'Zoë O’Brien-Šimek', address: '12 Rue de l’Église, Paris' },
  secondaryExecutor: { name: '李明', address: '北京市' },
  specificGifts: [gift('g1', '李明', 'my jade 🐍 figurine')],
  beneficiaries: [
    ben('b1', 'Zoë O’Brien-Šimek', 'wife', '50'),
    ben('b2', '李明', 'son', '30', { isOwnChild: true }),
    ben('b3', 'Emoji Child 😀🎉', 'daughter', '20', { isOwnChild: true }),
  ],
  ultimateBackstop: 'the École Foundation 🎓',
  funeralWishes: 'Play “Ave María” — no flowers.',
};

// ------------------------------------------- multi-line / whitespace address
const whitespaceAddress = {
  ...clone(baseline),
  address: '22 Castleton Road\nRuislip\nMiddlesex\nHA4 9QJ',
  partnerAddress: '   22 Castleton Road, Ruislip, HA4 9QJ   ',
  primaryExecutor: { name: '  Robert Hughes  ', address: '\n5 Elm Grove\nWatford\nWD17 1AB\n' },
  secondaryExecutor: { name: 'Sarah Hughes', address: '   ' },
  funeralWishes: '  A simple service.\nNo flowers.  ',
};

// ------------------------------------------------- ultimateBackstop blank
const backstopBlank = { ...clone(baseline), ultimateBackstop: '' };

// -------------------------------------------------- ultimateBackstop vague
const backstopVague = { ...clone(baseline), ultimateBackstop: 'my cousins' };

// ============================================================================
// Round 2 — one scenario per fix, so the re-run proves the fix rather than
// re-proving by inspection that the original bug is gone.
// ============================================================================

// Transliterable-but-not-Latin-1. Must come out as "Michal Kowalski", never as
// "Micha Kowalski" — the first round silently DELETED the character.
const translitName = {
  ...clone(baseline),
  fullName: 'Michał Kowalski',
  partnerName: 'Zoë Ó Briain',
  primaryExecutor: { name: 'Ingrīda Bērziņa', address: '3 Gertrudes iela, Riga' },
  beneficiaries: [ben('b1', 'Zoë Ó Briain', 'wife', '100')],
  ultimateBackstop: 'the École Foundation',
};

// Untransliterable. Must be REFUSED — a will naming somebody else is worse than
// no will, and dropping the characters produces exactly that.
const untransliterableName = { ...clone(baseline), fullName: '李明' };

// Under 18 — Wills Act 1837 s.7. A 16-year-old's will is void; producing one
// that looks valid is the most dangerous output this app could generate.
const under18 = { ...clone(baseline), dob: '01/06/2012' };

// Date of birth in the future.
const futureDob = { ...clone(baseline), dob: '01/06/2099' };

// A date that does not exist. Used to roll silently to 2 March.
const impossibleDob = { ...clone(baseline), dob: '31/02/1985' };

// ISO order typed into a DD/MM/YYYY field. Must be refused rather than read as
// a real date.
const isoDobTyped = { ...clone(baseline), dob: '1985-03-14' };

// Shares parseFloat used to accept: "50abc" became 50, "50." printed into the
// operative words as "50.%".
const junkPercentages = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50abc'),
    ben('b2', 'Oliver Smith', 'son', '50', { isOwnChild: true }),
  ],
};

const trailingDotPercentage = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50.'),
    ben('b2', 'Oliver Smith', 'son', '50', { isOwnChild: true }),
  ],
};

// Decimal shares that do add to 100. Must be allowed, and must not print as
// "33.3300000001%".
const decimalThirds = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '33.33'),
    ben('b2', 'Oliver Smith', 'son', '33.33', { isOwnChild: true }),
    ben('b3', 'Amelia Smith', 'daughter', '33.34', { isOwnChild: true }),
  ],
};

// A named substitution with nobody named.
const namedSubBlank = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '100', {
      substitution: { type: 'named', namedPerson: '' },
    }),
  ],
};

// A beneficiary with a share but no name.
const unnamedBeneficiary = {
  ...clone(baseline),
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50'),
    ben('b2', '', '', '50'),
  ],
};

// No executor named at all.
const noExecutor = {
  ...clone(baseline),
  primaryExecutor: { name: '', address: '' },
  secondaryExecutor: { name: '', address: '' },
};

// Guardians left behind after the children's dates of birth were corrected to
// adult ones. The clause stays in the will — it is the user's express choice and
// is legally inert once every child is 18 — but a warning has to say so, because
// silently deleting an appointment the user made is the worse failure.
const adultChildrenStaleGuardians = {
  ...clone(baseline),
  guardians: [{ id: 'gu1', name: 'Robert Hughes', address: '5 Elm Grove, Watford', role: 'primary' }],
};

// Single, no partner, no children — the family declaration clause should be
// absent entirely rather than printed with blanks in it.
const singleNoFamily = {
  ...clone(baseline),
  maritalStatus: 'single',
  partnerName: '',
  partnerAddress: '',
  children: [],
  beneficiaries: [ben('b1', 'Michael Doyle', 'friend', '100')],
};

// Divorced — checks the s.18A explanatory wording reaches somebody it affects.
const divorced = {
  ...clone(baseline),
  maritalStatus: 'divorced',
  partnerName: '',
  partnerAddress: '',
};

// "Free of tax" alongside a charity gift — the tax clause has to distinguish
// the two.
const freeOfTaxAndCharity = {
  ...clone(baseline),
  specificGifts: [
    gift('g1', 'Michael Doyle', 'my 1968 Gibson guitar', { taxBurden: 'freeOfTax' }),
    gift('g2', 'Cancer Research UK', 'the sum of five thousand pounds', { isCharity: true }),
  ],
};

// Long free text — checks pagination, and that nothing is clipped off a page.
const longText = {
  ...clone(baseline),
  funeralWishes: ('I should like a service at the parish church, with the hymns my mother chose, ' +
    'followed by a reception at the village hall for anyone who wishes to attend. ').repeat(8),
  ultimateBackstop: ('the Royal National Lifeboat Institution, registered charity number 209603, ' +
    'for its general charitable purposes ').repeat(4),
};

module.exports = {
  baseline,
  'zero-residuary': zeroResiduary,
  'percentages-90': pct90,
  'percentages-110': pct110,
  'single-beneficiary-100': single100,
  'minors-with-guardians': minorsWithGuardians,
  'minors-no-guardians': minorsNoGuardians,
  'guardians-with-substitute': guardiansWithSubstitute,
  'guardians-single-plus-substitute': guardiansSinglePlusSubstitute,
  'spouse-omitted': spouseOmitted,
  'divorced-spouse-not-beneficiary': divorcedSpouseNotBeneficiary,
  'guardians-substitute-only': guardiansSubstituteOnly,
  'gifts-only-no-residuary': giftsOnlyNoResiduary,
  'thirty-specific-gifts': thirtyGifts,
  'charity-named-sub-blank': charityNamedBlankSub,
  'fully-empty': fullyEmpty,
  'unicode-names': unicodeNames,
  'whitespace-address': whitespaceAddress,
  'backstop-blank': backstopBlank,
  'backstop-vague': backstopVague,

  // round 2
  'translit-name': translitName,
  'untransliterable-name': untransliterableName,
  'under-18': under18,
  'future-dob': futureDob,
  'impossible-dob': impossibleDob,
  'iso-dob-typed': isoDobTyped,
  'junk-percentages': junkPercentages,
  'trailing-dot-percentage': trailingDotPercentage,
  'decimal-thirds': decimalThirds,
  'named-sub-blank': namedSubBlank,
  'unnamed-beneficiary': unnamedBeneficiary,
  'no-executor': noExecutor,
  'adult-children-stale-guardians': adultChildrenStaleGuardians,
  'single-no-family': singleNoFamily,
  'divorced': divorced,
  'free-of-tax-and-charity': freeOfTaxAndCharity,
  'long-text': longText,
};
