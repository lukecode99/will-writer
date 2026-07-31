/**
 * Tests for the link between the Family step and the residuary shares.
 *
 * The audit harness renders documents, and the storage tests check that answers
 * survive. Neither can see what this file is about, which is what happens
 * *between* two screens: someone names their children, goes on to leave them
 * shares, then goes back and corrects a spelling. Everything in that sequence is
 * valid at every point, no document is refused, and nothing is lost — so a
 * regression here produces a will that generates perfectly and leaves out a
 * child, which is the only class of bug in this app that reaches a court.
 *
 * `people.ts` and `validation.ts` are pure functions over a will, so there is no
 * storage to stub — the modules are required directly through the TS hook.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(join(ROOT, 'package.json'));
require('sucrase/register/ts');

const { PARTNER_REF, childRef, knownPeople, knownRefs, syncLinkedBeneficiaries } =
  require(join(ROOT, 'src/people.ts'));
const { warnings, blockingProblems } = require(join(ROOT, 'src/validation.ts'));
const { EMPTY_WILL } = require(join(ROOT, 'src/types.ts'));

let failures = 0;
let ran = 0;

function check(label, condition, detail) {
  ran++;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

const clone = o => JSON.parse(JSON.stringify(o));

function ben(id, name, percentage, opts = {}) {
  return {
    id,
    name,
    relationship: opts.relationship || '',
    percentage,
    isOwnChild: opts.isOwnChild || false,
    isMinor: false,
    substitution: { type: 'per-stirpes', namedPerson: '' },
    linkedPersonId: opts.linkedPersonId || '',
  };
}

/** Married, two children, everything shared out, no complaints. */
function family() {
  return {
    ...clone(EMPTY_WILL),
    fullName: 'John Andrew Smith',
    dob: '14/03/1985',
    maritalStatus: 'married',
    partnerName: 'Jane Elizabeth Smith',
    children: [
      { id: 'c1', name: 'Oliver Smith', dob: '01/06/2004' },
      { id: 'c2', name: 'Amelia Smith', dob: '12/09/2006' },
    ],
    primaryExecutor: { name: 'Robert Hughes', address: '9 Mill Lane' },
    beneficiaries: [
      ben('b1', 'Jane Elizabeth Smith', '50', { relationship: 'wife', linkedPersonId: PARTNER_REF }),
      ben('b2', 'Oliver Smith', '30', { isOwnChild: true, relationship: 'son', linkedPersonId: childRef('c1') }),
      ben('b3', 'Amelia Smith', '20', { isOwnChild: true, relationship: 'daughter', linkedPersonId: childRef('c2') }),
    ],
    ultimateBackstop: 'the British Heart Foundation',
  };
}

const messages = data => warnings(data).map(w => w.message).join(' | ');

// --- who is offered ---------------------------------------------------------

{
  const people = knownPeople(family());
  check('the partner and both children are offered, in the order entered',
    people.map(p => p.name).join(',') === 'Jane Elizabeth Smith,Oliver Smith,Amelia Smith');
  check('the partner of a married user is described as a spouse',
    people[0].relationship === 'spouse');
  check('children are marked as own children, the partner is not',
    people[0].isOwnChild === false && people[1].isOwnChild && people[2].isOwnChild);

  // Not cosmetic. The relationship goes into the will as a description of who
  // this person is, and an unmarried partner has no spousal rights — calling
  // them a spouse in a signed document would be a plain statement of something
  // untrue, printed by us rather than typed by the user.
  const cohabiting = { ...family(), maritalStatus: 'single' };
  check('an unmarried partner is not described as a spouse',
    knownPeople(cohabiting)[0].relationship === 'partner');

  const civil = { ...family(), maritalStatus: 'civilPartnership' };
  check('a civil partner is described as a civil partner',
    knownPeople(civil)[0].relationship === 'civil partner');

  // A blank button in a list of people to inherit from reads as a bug, and
  // there is nothing to put on it.
  const halfTyped = family();
  halfTyped.children = [{ id: 'c1', name: '', dob: '' }, halfTyped.children[1]];
  check('a child with no name yet is not offered',
    knownPeople(halfTyped).every(p => p.name !== ''));

  // But the child still exists. A name cleared mid-edit is a typo being fixed,
  // not a deletion, and if `knownRefs` dropped the child here the app would tell
  // the user their beneficiary had vanished from the family details while they
  // were half-way through correcting the spelling.
  check('a child with no name yet is still a live reference',
    knownRefs(halfTyped).has(childRef('c1')));

  // The partner has no remove button — clearing the name is the only way — so
  // for the partner, and only the partner, a blank name is a removal.
  const noPartner = { ...family(), partnerName: '   ' };
  check('a cleared partner name is a removed partner',
    !knownRefs(noPartner).has(PARTNER_REF));
}

// --- the two screens stay in step ------------------------------------------

{
  const data = family();
  data.children[0].name = 'Oliver James Smith';
  const synced = syncLinkedBeneficiaries(data);
  check('correcting a child\'s name on the Family step corrects their share',
    synced.beneficiaries[1].name === 'Oliver James Smith');
  check('the other shares are left alone',
    synced.beneficiaries[0].name === 'Jane Elizabeth Smith'
    && synced.beneficiaries[2].name === 'Amelia Smith');
}

{
  // The same edit against a share that was typed by hand. It must not follow:
  // an unlinked entry is a name the user wrote, and rewriting it from another
  // screen would change who inherits without anyone asking for it.
  const data = family();
  data.beneficiaries[1] = ben('b2', 'Oliver Smith', '30', { isOwnChild: true });
  data.children[0].name = 'Oliver James Smith';
  const synced = syncLinkedBeneficiaries(data);
  check('a hand-typed share does not follow a Family-step rename',
    synced.beneficiaries[1].name === 'Oliver Smith');
}

{
  const data = family();
  data.partnerName = 'Jane E Smith';
  check('renaming the partner renames their share',
    syncLinkedBeneficiaries(data).beneficiaries[0].name === 'Jane E Smith');
}

{
  // `isOwnChild` drives the per-stirpes warning. If it could drift out of step
  // with the family details, the warning would be switched off for exactly the
  // person it is about.
  const data = family();
  data.beneficiaries[1].isOwnChild = false;
  check('a linked child is put back to being a child',
    syncLinkedBeneficiaries(data).beneficiaries[1].isOwnChild === true);

  const partnerTicked = family();
  partnerTicked.beneficiaries[0].isOwnChild = true;
  check('a linked partner is put back to not being a child',
    syncLinkedBeneficiaries(partnerTicked).beneficiaries[0].isOwnChild === false);
}

{
  // This runs inside a per-keystroke autosave. Returning a new object when
  // nothing changed would rewrite every will to disk on every keypress, for a
  // change that was not there.
  const data = family();
  check('nothing to do means the very same object back',
    syncLinkedBeneficiaries(data) === data);

  const unlinked = family();
  unlinked.beneficiaries = unlinked.beneficiaries.map(b => ({ ...b, linkedPersonId: '' }));
  check('a will with no links at all is returned untouched',
    syncLinkedBeneficiaries(unlinked) === unlinked);
}

{
  // Removing someone from the family details is not an instruction to
  // disinherit them. Both the share and the last known name stand, and the link
  // stands too — it is the only surviving record that these two entries were
  // ever the same person, and the user is the one who gets to say which screen
  // is right.
  const data = family();
  data.children = [data.children[1]];
  const synced = syncLinkedBeneficiaries(data);
  check('deleting a child does not delete their share',
    synced.beneficiaries.length === 3 && synced.beneficiaries[1].percentage === '30');
  check('deleting a child does not blank the name on their share',
    synced.beneficiaries[1].name === 'Oliver Smith');
  check('deleting a child does not silently break the link',
    synced.beneficiaries[1].linkedPersonId === childRef('c1'));
  check('the disagreement between the two screens is reported',
    messages(synced).includes('no longer'));
}

// --- what the review screen says -------------------------------------------

{
  const clean = family();
  check('a will where everyone is provided for draws no complaint',
    !messages(clean).includes('not left anything'));

  // The whole point. Two spellings of one child, and the link settles it.
  const renamed = syncLinkedBeneficiaries((() => {
    const d = family();
    d.children[0].name = 'Oliver James Smith';
    return d;
  })());
  check('a linked child is never reported as left out',
    !messages(renamed).includes('not left anything'));

  // And the check still has teeth for anyone the picker was not used for.
  const omitted = family();
  omitted.beneficiaries = [
    ben('b1', 'Jane Elizabeth Smith', '100', { linkedPersonId: PARTNER_REF }),
  ];
  const said = messages(omitted);
  check('a child with no share at all is still reported',
    said.includes('Oliver Smith') && said.includes('Amelia Smith'));

  // The spouse path is separate code with a separate reference. A fix that only
  // reached the children would look complete in the diff.
  const spouseRenamed = family();
  spouseRenamed.beneficiaries[0].name = 'Jane E Smith';
  check('a linked spouse is never reported as left out',
    !messages(spouseRenamed).includes('is your spouse and is not left anything'));

  const spouseOmitted = family();
  spouseOmitted.beneficiaries = spouseOmitted.beneficiaries.slice(1);
  spouseOmitted.beneficiaries[0].percentage = '50';
  spouseOmitted.beneficiaries[1].percentage = '50';
  check('a spouse with no share at all is still reported',
    messages(spouseOmitted).includes('is your spouse and is not left anything'));
}

{
  // The picker cannot produce this — a person leaves the list the moment they
  // are chosen — but "someone else" is free text. One person written down twice
  // is paid twice, and the percentages still come to 100, so no other check in
  // the app can see it.
  const twice = family();
  twice.beneficiaries[2] = ben('b3', 'oliver smith', '20', { isOwnChild: true });
  const said = messages(twice);
  check('one person entered twice is reported', said.includes('appears more than once'));
  check('the duplicate is reported in the spelling the user actually typed',
    said.includes('Oliver Smith'));

  // Reported once, not once per extra copy. A warning repeated three times for
  // one mistake makes the list look broken.
  const thrice = family();
  thrice.beneficiaries = [
    ben('b1', 'Jane Elizabeth Smith', '40'),
    ben('b2', 'Oliver Smith', '20'),
    ben('b3', 'Oliver Smith', '20'),
    ben('b4', 'oliver smith', '20'),
  ];
  const dupWarnings = warnings(thrice).filter(w => w.message.includes('appears more than once'));
  check('a name entered three times is still one warning', dupWarnings.length === 1);

  // Two people can genuinely share a name — a father and a son is the obvious
  // case, and it is exactly the family where it is most likely to be deliberate.
  // So it warns; it must never block. Checked against the blocking list rather
  // than the warning list, because asserting that a warning is a warning proves
  // nothing.
  check('a duplicate name does not stop the will being generated',
    blockingProblems(thrice).every(p => !p.message.includes('more than once')));
}

console.log(`\n${ran} checks, ${ran - failures} passed, ${failures} failed.`);
if (failures) process.exitCode = 1;
