/** Adversarial probe: build wills that SHOULD be flagged and see what the app says. */
import { createRequire } from 'node:module';
const ROOT = '/workspace/agent/projects/will-writer';
const require = createRequire(ROOT + '/package.json');
require('sucrase/register/ts');
const { blockingProblems, warnings } = require(ROOT + '/src/validation.ts');
const { knownPeople } = require(ROOT + '/src/people.ts');

const EMPTY = {
  isForSomeoneElse: false, fullName: '', address: '', dob: '', maritalStatus: '',
  partnerName: '', partnerAddress: '', children: [], childrenConfirmed: true,
  primaryExecutor: { name: '', address: '' }, secondaryExecutor: { name: '', address: '' },
  backupExecutor: { name: '', address: '' }, guardians: [], specificGifts: [],
  beneficiaries: [], ultimateBackstop: '', funeralWishes: '', burialPreference: '',
};
const clone = o => JSON.parse(JSON.stringify(o));
const ben = (id, name, rel, pct, o = {}) => ({
  id, name, relationship: rel, percentage: pct,
  isOwnChild: o.isOwnChild || false, isMinor: o.isMinor || false,
  substitution: o.substitution || { type: 'per-stirpes', namedPerson: '' },
  linkedPersonId: o.linkedPersonId || '',
});

const base = {
  ...clone(EMPTY),
  fullName: 'John Andrew Smith', address: '22 Castleton Road, Ruislip, HA4 9QJ',
  dob: '14/03/1985', maritalStatus: 'married',
  partnerName: 'Jane Elizabeth Smith', partnerAddress: '22 Castleton Road, Ruislip, HA4 9QJ',
  children: [{ id: 'c1', name: 'Oliver Smith', dob: '01/06/2004' }],
  primaryExecutor: { name: 'Robert Hughes', address: '5 Elm Grove, Watford, WD17 1AB' },
  secondaryExecutor: { name: 'Sarah Hughes', address: '5 Elm Grove, Watford, WD17 1AB' },
  beneficiaries: [
    ben('b1', 'Jane Elizabeth Smith', 'wife', '50', { linkedPersonId: 'p:partner' }),
    ben('b2', 'Oliver Smith', 'son', '50', { isOwnChild: true, linkedPersonId: 'c:c1' }),
  ],
  ultimateBackstop: 'the British Heart Foundation',
  funeralWishes: 'A simple service with family only.', burialPreference: 'cremation',
};

function report(title, data, note) {
  const b = blockingProblems(data), w = warnings(data);
  console.log('\n' + '='.repeat(78));
  console.log('## ' + title);
  if (note) console.log('   ' + note);
  console.log('   BLOCKS  : ' + (b.length ? '' : '(none)'));
  b.forEach(p => console.log('     [' + p.step + '] ' + p.message));
  console.log('   WARNINGS: ' + (w.length ? '' : '(none)'));
  w.forEach(p => console.log('     [' + p.step + '] ' + p.message));
}

// ---- 1. child typed by hand, isOwnChild left off, named substitute ----------
const handTypedChild = clone(base);
handTypedChild.beneficiaries = [
  ben('b1', 'Jane Elizabeth Smith', 'wife', '50', { linkedPersonId: 'p:partner' }),
  // Same human being as child c1. Added via "+ Add someone else", so unlinked
  // and isOwnChild defaults to false. Named substitution displaces s.33 anyway.
  ben('b2', 'Oliver Smith', 'son', '50', {
    substitution: { type: 'named', namedPerson: 'Michael Doyle' },
  }),
];
report('1. own child added by hand, isOwnChild off, NAMED substitute', handTypedChild,
  'Oliver is c1 on the Family step. s.33 applies as a matter of law regardless of the toggle.');

// ---- 2. cohabiting partner left out entirely -------------------------------
const cohabitee = clone(base);
cohabitee.maritalStatus = 'single';
cohabitee.partnerName = 'Samantha Leaver';
cohabitee.partnerAddress = '22 Castleton Road, Ruislip, HA4 9QJ';
cohabitee.beneficiaries = [ben('b2', 'Oliver Smith', 'son', '100', { isOwnChild: true, linkedPersonId: 'c:c1' })];
report('2. unmarried live-in partner, left nothing', cohabitee,
  'knownPeople labels her: ' + JSON.stringify(knownPeople(cohabitee).map(p => p.relationship)));

// ---- 3. beneficiary named as their own substitute --------------------------
const selfSub = clone(base);
selfSub.beneficiaries = [
  ben('b1', 'Jane Elizabeth Smith', 'wife', '50', {
    substitution: { type: 'named', namedPerson: 'Jane Elizabeth Smith' },
  }),
  ben('b2', 'Oliver Smith', 'son', '50', { isOwnChild: true, linkedPersonId: 'c:c1' }),
];
report('3. Jane is her own substitute', selfSub,
  'If she predeceases, her share passes to her. The clause disposes of nothing.');

// ---- 4. a minor child appointed as executor --------------------------------
const minorExec = clone(base);
minorExec.children = [{ id: 'c1', name: 'Oliver Smith', dob: '01/06/2016' }];
minorExec.primaryExecutor = { name: 'Oliver Smith', address: '22 Castleton Road, Ruislip, HA4 9QJ' };
minorExec.secondaryExecutor = { name: '', address: '' };
minorExec.guardians = [{ id: 'g1', name: 'Robert Hughes', address: '5 Elm Grove', role: 'primary' }];
report('4. a 10-year-old appointed as sole executor', minorExec,
  'A minor cannot take a grant. Sole minor executor => letters of administration with will annexed.');

// ---- 5. a minor child appointed as guardian of the other children ----------
const childGuardian = clone(base);
childGuardian.children = [
  { id: 'c1', name: 'Oliver Smith', dob: '01/06/2016' },
  { id: 'c2', name: 'Amelia Smith', dob: '12/09/2019' },
];
childGuardian.guardians = [{ id: 'g1', name: 'Oliver Smith', address: '22 Castleton Road', role: 'primary' }];
childGuardian.beneficiaries = [ben('b1', 'Jane Elizabeth Smith', 'wife', '100', { linkedPersonId: 'p:partner' })];
report('5. a 10-year-old appointed as guardian of his 7-year-old sister', childGuardian);

// ---- 6. shares that pass tolerance but do not dispose of the estate --------
const thirds = clone(base);
thirds.children = [
  { id: 'c1', name: 'Oliver Smith', dob: '01/06/2004' },
  { id: 'c2', name: 'Amelia Smith', dob: '12/09/2006' },
  { id: 'c3', name: 'Harry Smith', dob: '04/02/2009' },
];
thirds.beneficiaries = [
  ben('b1', 'Oliver Smith', 'son', '33.33', { isOwnChild: true, linkedPersonId: 'c:c1' }),
  ben('b2', 'Amelia Smith', 'daughter', '33.33', { isOwnChild: true, linkedPersonId: 'c:c2' }),
  ben('b3', 'Harry Smith', 'son', '33.33', { isOwnChild: true, linkedPersonId: 'c:c3' }),
];
thirds.partnerName = '';
thirds.maritalStatus = 'single';
report('6. three shares of 33.33% = 99.99%', thirds,
  'Inside PERCENT_TOLERANCE. Does the document dispose of the last 0.01%?');

// ---- 7. testator names themselves ------------------------------------------
const selfExec = clone(base);
selfExec.primaryExecutor = { name: 'John Andrew Smith', address: '22 Castleton Road, Ruislip, HA4 9QJ' };
selfExec.secondaryExecutor = { name: '', address: '' };
selfExec.beneficiaries = [
  ben('b1', 'Jane Elizabeth Smith', 'wife', '50', { linkedPersonId: 'p:partner' }),
  ben('b2', 'John Andrew Smith', 'myself', '50'),
];
report('7. the testator is his own executor AND his own beneficiary', selfExec);

// ---- 8. about to marry ------------------------------------------------------
const engaged = clone(base);
engaged.maritalStatus = 'single';
engaged.partnerName = 'Samantha Leaver';
engaged.beneficiaries = [
  ben('b1', 'Samantha Leaver', 'fiancee', '50', { linkedPersonId: 'p:partner' }),
  ben('b2', 'Oliver Smith', 'son', '50', { isOwnChild: true, linkedPersonId: 'c:c1' }),
];
report('8. engaged, marrying in three months, partner IS provided for', engaged,
  'On marriage the whole will is revoked (s.18) unless made in expectation of it. No field can say so.');
