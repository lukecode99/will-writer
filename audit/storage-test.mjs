/**
 * Storage tests.
 *
 * The rest of the audit exercises the document — what the will says, and when
 * the app refuses to produce one. This file exercises the thing underneath it:
 * whether the answers survive.
 *
 * It exists because the home screen changed storage from "one will under one
 * key" to "a list of wills under another key", and the failure mode of getting
 * that wrong is the worst one this app has. Nothing is on a server. If the
 * migration drops a draft, or a second will overwrites the first, the user's
 * only copy is gone and there is no error to notice — the app just opens on a
 * blank form, exactly as it would for a new install.
 *
 * AsyncStorage is replaced with an in-memory stub injected into the require
 * cache, so each case starts from a known store and the module is re-required
 * to reset its `hydrated` latch.
 */
import { createRequire } from 'node:module';
import Module from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(join(ROOT, 'package.json'));
require('sucrase/register/ts');

const ASYNC_ID = require.resolve('@react-native-async-storage/async-storage');
const STORAGE_ID = require.resolve(join(ROOT, 'src/storage.ts'));

/** Minimal AsyncStorage. `dropWrites` makes setItem resolve without storing,
 *  which is the out-of-space case flushWill's read-back is there to catch. */
function makeStore(initial = {}, { dropWrites = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    api: {
      async getItem(k) { return map.has(k) ? map.get(k) : null; },
      async setItem(k, v) { if (!dropWrites) map.set(k, v); },
      async removeItem(k) { map.delete(k); },
      async multiGet(keys) { return keys.map(k => [k, map.has(k) ? map.get(k) : null]); },
      async multiSet(pairs) { if (!dropWrites) for (const [k, v] of pairs) map.set(k, v); },
      async multiRemove(keys) { for (const k of keys) map.delete(k); },
    },
  };
}

/** Fresh copy of storage.ts wired to a fresh stub. */
function freshStorage(initial, opts) {
  const store = makeStore(initial, opts);
  Module._cache[ASYNC_ID] = {
    id: ASYNC_ID,
    filename: ASYNC_ID,
    loaded: true,
    exports: { __esModule: true, default: store.api },
  };
  delete Module._cache[STORAGE_ID];
  return { store, storage: require(STORAGE_ID) };
}

const DOCS_KEY = 'willWriter.docs.v1';
const CORRUPT_KEY = 'willWriter.docs.v1.corrupt';
const LEGACY_KEY = 'willWriter.v1';
const LEGACY_STEP_KEY = 'willWriter.step.v1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function test(name, fn) {
  try {
    await fn();
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name} threw: ${err && err.stack}`);
  }
}

// --- 1. a new install starts empty, and does not invent a will -------------
await test('fresh install', async () => {
  const { storage } = freshStorage({});
  await storage.hydrateStorage();
  check('fresh install has no saved wills', storage.listWills().length === 0);
});

// --- 2. the single will saved by the previous version is not lost ----------
await test('legacy migration', async () => {
  const legacy = { fullName: 'Margaret Anne Hale', address: '3 Crampton Terrace', dob: '19/05/1951' };
  const { store, storage } = freshStorage({
    [LEGACY_KEY]: JSON.stringify(legacy),
    [LEGACY_STEP_KEY]: '4',
  });
  await storage.hydrateStorage();
  const list = storage.listWills();

  check('legacy draft becomes exactly one saved will', list.length === 1,
    `got ${list.length}`);
  check('legacy draft keeps its name', list[0]?.title === 'Margaret Anne Hale',
    `got ${JSON.stringify(list[0]?.title)}`);
  check('legacy draft is treated as the user\'s own', list[0]?.isForSomeoneElse === false);
  check('legacy draft resumes on the step it was left on', storage.loadStep(list[0].id) === 4,
    `got ${storage.loadStep(list[0]?.id)}`);
  check('legacy draft keeps its answers', storage.loadWillData(list[0].id).dob === '19/05/1951');
  check('migration is written to disk, not just held in memory',
    store.map.has(DOCS_KEY));
  check('the old key is left alone so a rollback still finds it',
    store.map.get(LEGACY_KEY) === JSON.stringify(legacy));

  // Second launch must not migrate again on top of the migrated copy.
  const again = freshStorage(Object.fromEntries(store.map));
  await again.storage.hydrateStorage();
  check('a second launch does not duplicate the migrated will',
    again.storage.listWills().length === 1,
    `got ${again.storage.listWills().length}`);
});

// --- 3. unreadable store: start empty, but keep the bytes ------------------
await test('corrupt store', async () => {
  const { store, storage } = freshStorage({ [DOCS_KEY]: '{not json' });
  await storage.hydrateStorage();
  check('a corrupt store still opens the app', storage.listWills().length === 0);
  await sleep(5); // the copy is written without being awaited
  check('a corrupt store is copied aside rather than discarded',
    store.map.get(CORRUPT_KEY) === '{not json',
    `got ${JSON.stringify(store.map.get(CORRUPT_KEY))}`);
});

// --- 4. several wills, kept apart -----------------------------------------
await test('multiple wills', async () => {
  const { store, storage } = freshStorage({});
  await storage.hydrateStorage();

  const mine = storage.createWill(false);
  const theirs = storage.createWill(true);

  const a = storage.loadWillData(mine);
  storage.saveWillData(mine, { ...a, fullName: 'Luke Holder' });
  const b = storage.loadWillData(theirs);
  storage.saveWillData(theirs, { ...b, fullName: 'Sharon Ritchie-Keeble' });

  check('both wills are listed', storage.listWills().length === 2);
  check('editing one will does not touch the other',
    storage.loadWillData(mine).fullName === 'Luke Holder' &&
    storage.loadWillData(theirs).fullName === 'Sharon Ritchie-Keeble');
  check('who the will is for is remembered per will',
    storage.loadWillData(mine).isForSomeoneElse === false &&
    storage.loadWillData(theirs).isForSomeoneElse === true);

  storage.saveStep(mine, 6);
  check('the step is remembered per will',
    storage.loadStep(mine) === 6 && storage.loadStep(theirs) === 0);

  // Most recently edited first.
  await sleep(5);
  storage.saveWillData(mine, { ...storage.loadWillData(mine), address: '22 Castleton Road' });
  check('the most recently edited will is listed first',
    storage.listWills()[0].id === mine,
    `first was ${storage.listWills()[0].id === theirs ? 'theirs' : 'neither'}`);

  storage.deleteWill(theirs);
  const after = storage.listWills();
  check('deleting one will removes only that one',
    after.length === 1 && after[0].id === mine);

  // Reopen from what actually reached disk.
  const reopened = freshStorage(Object.fromEntries(store.map));
  await reopened.storage.hydrateStorage();
  const list = reopened.storage.listWills();
  check('the surviving will is still there after a restart',
    list.length === 1 && list[0].title === 'Luke Holder',
    `got ${JSON.stringify(list)}`);
  check('answers survive a restart',
    reopened.storage.loadWillData(list[0].id).address === '22 Castleton Road');
  check('the deleted will does not come back after a restart',
    !JSON.stringify(Object.fromEntries(store.map)).includes('Ritchie-Keeble'));
});

// --- 5. the Save button has to be able to fail -----------------------------
await test('flush read-back', async () => {
  const ok = freshStorage({});
  await ok.storage.hydrateStorage();
  ok.storage.createWill(false);
  let threw = false;
  try { await ok.storage.flushWill(); } catch { threw = true; }
  check('a working store flushes without error', !threw);

  const bad = freshStorage({}, { dropWrites: true });
  await bad.storage.hydrateStorage();
  bad.storage.createWill(false);
  let caught = null;
  try { await bad.storage.flushWill(); } catch (err) { caught = err; }
  check('a store that silently drops writes is reported, not trusted',
    caught !== null,
    'flushWill resolved even though nothing was stored');
});

// --- 6. old drafts keep opening -------------------------------------------
await test('field defaults on old drafts', async () => {
  // A draft saved before beneficiaries had substitution rules, gifts had a tax
  // choice, or wills knew who they were for.
  const old = {
    fullName: 'John Thornton',
    beneficiaries: [{ name: 'Fanny', percentage: '100' }],
    specificGifts: [{ recipient: 'Nicholas Higgins', description: 'the mill ledger' }],
    // Saved before guardians were split into first-choice and substitute, when
    // the screen showed a numbered list and the will joined them with "and".
    guardians: [
      { id: 'gu1', name: 'Hannah Thornton', address: 'Marlborough Mills' },
      { id: 'gu2', name: 'Adam Bell', address: 'Helstone' },
    ],
  };
  const { storage } = freshStorage({ [LEGACY_KEY]: JSON.stringify(old) });
  await storage.hydrateStorage();
  const data = storage.loadWillData(storage.listWills()[0].id);

  check('an old beneficiary gets an id and a substitution rule',
    !!data.beneficiaries[0].id && data.beneficiaries[0].substitution.type === 'per-stirpes');
  check('an old gift defaults to bearing its own tax, which leaves residue intact',
    data.specificGifts[0].taxBurden === 'bearsOwnTax');
  check('an old single-string gift recipient migrates to a one-entry recipients list',
    data.specificGifts[0].recipients.length === 1 && data.specificGifts[0].recipients[0].name === 'Nicholas Higgins',
    `got ${JSON.stringify(data.specificGifts[0].recipients)}`);
  check('an old draft is not silently marked as being for someone else',
    data.isForSomeoneElse === false);
  // The migration that matters most: these two were appointed jointly, and
  // reopening the will must not turn one of them into a fallback for the
  // other. Defaulting to 'substitute' would have been the same bug the split
  // was written to fix, only in reverse.
  check('guardians saved before the split reopen as joint first choices',
    data.guardians.length === 2 && data.guardians.every(g => g.role === 'primary'));
  // Unlinked, and it has to stay that way. Fanny was typed by hand, and the
  // only thing the app could use to link her to a person is her name — which is
  // precisely the guess the link was added to remove. She goes on being matched
  // by name, so this draft behaves exactly as it did before the picker existed.
  check('an old beneficiary reopens unlinked, not guessed at',
    data.beneficiaries[0].linkedPersonId === '');
  // This draft was written before anyone was asked whether the list of children
  // was complete, so the honest answer is that we do not know. Defaulting it to
  // true would convert "never asked" into "confirmed", which is the one value
  // the field must never take without a person putting it there.
  check('a draft saved before the question was asked reopens unanswered',
    data.childrenConfirmed === false);
});

/**
 * A will saved by one build and reopened by another.
 *
 * Adding a fourth substitution type made this reachable for the first time, and
 * the traffic runs both ways: a will written on a phone that has updated gets
 * opened on one that has not, and old builds stay installed for a long time.
 *
 * The unknown string used to be stored as-is and handed to the clause switch,
 * which matches no branch and returns undefined — a will with the substitution
 * paragraph missing entirely, and no error, no gap marker and nothing on the
 * review screen to say so. The one failure this app cannot afford is the silent
 * one, because the document looks finished either way.
 */
await test('substitution types the build does not recognise', async () => {
  const docs = [{
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: {
      fullName: 'Luke Holder',
      children: [],
      beneficiaries: [
        { id: 'b1', name: 'Jane Smith', percentage: '50', substitution: { type: 'own-children', namedPerson: '' } },
        { id: 'b2', name: 'Amy Doyle', percentage: '30', substitution: { type: 'quantum-entanglement', namedPerson: '' } },
        { id: 'b3', name: 'Rob Hughes', percentage: '20', substitution: { type: 'named', namedPerson: 42 } },
      ],
      specificGifts: [], guardians: [],
    },
  }];
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const [a, b, c] = storage.loadWillData('d1').beneficiaries;

  check('a substitution this build understands survives reopening',
    a.substitution.type === 'own-children');
  // Per stirpes because it is what a new beneficiary starts as, so the fallback
  // is the app's own default rather than a choice made quietly on someone's
  // behalf. It is still a changed provision, but a visible one: it shows on the
  // residuary screen and in the preview, where it can be seen and put back.
  // (When the unknown type arrives WITH a legacy named person, the intent was
  // plainly "named" and it lands there instead — tested further down.)
  check('an unrecognised substitution falls back to the default, not to nothing',
    b.substitution.type === 'per-stirpes');
  // These values are concatenated straight into a sentence of the will, so a
  // number here becomes a number in the document.
  check('a named person that is not a string is not concatenated into the will',
    Array.isArray(c.substitution.substitutes) && c.substitution.substitutes.length === 0);
});

/**
 * The substitution field changed shape: one free-text `namedPerson` became a
 * list of people with a share each.
 *
 * Every will already saved on a phone has the old shape, and this is the only
 * code between those files and a document that gets signed. What it must
 * guarantee is not that the draft survives but that it still SAYS THE SAME
 * THING — a migration that quietly re-apportions an estate would be worse than
 * one that failed loudly.
 *
 * The old field meant "the whole of this beneficiary's share to this person",
 * so it migrates to a single entry on 100%, which is the one case the clause
 * generator writes without any apportionment at all: "shall pass to X
 * absolutely", word for word what the old build produced.
 *
 * The string is deliberately not parsed. "Jacob and Keira in equal shares" is
 * two people to a reader, but it is also exactly how a couple taking jointly
 * gets typed, and splitting it would be the app guessing at who inherits. It
 * comes back whole, on a screen that now shows it in a list with a share box
 * beside it, where the ambiguity is visible and the user's to resolve.
 */
await test('substitutions saved before substitutes were a list', async () => {
  const docs = [{
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: {
      fullName: 'Luke Holder',
      children: [],
      beneficiaries: [
        { id: 'b1', name: 'Sam', percentage: '60', substitution: { type: 'named', namedPerson: 'Michael Doyle' } },
        { id: 'b2', name: 'Amy', percentage: '40', substitution: { type: 'named', namedPerson: 'Jacob and Keira in equal shares' } },
      ],
      specificGifts: [], guardians: [],
    },
  }];
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const [a, b] = storage.loadWillData('d1').beneficiaries;

  check('the old single name migrates to one substitute, not to none',
    a.substitution.substitutes.length === 1 && a.substitution.substitutes[0].name === 'Michael Doyle');
  // 100% is what makes the regenerated will identical: one substitute on the
  // whole share is written without apportionment, so no "as to N% thereof"
  // appears where the old document had none.
  check('that substitute takes the whole of the share, as the old wording did',
    a.substitution.substitutes[0].share === '100');
  check('every migrated substitute has an id, so the list can be edited',
    typeof a.substitution.substitutes[0].id === 'string' && a.substitution.substitutes[0].id !== '');
  check('a name that reads like two people is not split on the app\'s guess',
    b.substitution.substitutes.length === 1
      && b.substitution.substitutes[0].name === 'Jacob and Keira in equal shares');
});

/**
 * One garbage sibling must not take the healthy wills with it.
 *
 * The old hydrate normalized every doc inside one shared map: a single
 * malformed element threw into the outer catch, which set docs = [] — every
 * HEALTHY will gone from the list, and the next write persisted the wipe while
 * the Save button reported success. Now each doc is handled on its own and the
 * unusable ones are filtered or parked, never allowed to empty the list.
 */
await test('a malformed sibling does not wipe healthy wills', async () => {
  const healthy = {
    id: 'd-good', step: 2, createdAt: 1, updatedAt: 2,
    data: { fullName: 'Margaret Anne Hale', children: [], beneficiaries: [], specificGifts: [], guardians: [] },
  };
  const docs = ['not a will', null, 42, healthy, { id: 'd-junk', data: 'also not a will', step: 'seven' }];
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const list = storage.listWills();

  check('the healthy will survives its malformed siblings',
    list.some(w => w.id === 'd-good' && w.title === 'Margaret Anne Hale'),
    `got ${JSON.stringify(list.map(w => w.id))}`);
  check('the healthy will keeps its step',
    storage.loadStep('d-good') === 2);
  // The junk OBJECT is still a doc shape — it normalizes to an empty draft
  // rather than being dropped, because dropping an object we merely failed to
  // understand is how data disappears between builds.
  check('an object doc with garbage fields reopens as an empty draft, not a crash',
    list.some(w => w.id === 'd-junk') && storage.loadWillData('d-junk').fullName === '');
});

/**
 * Two wills sharing an id made deleting one delete both — deleteWill filters
 * by id, so a duplicated id was one tap away from removing a will the user
 * never touched.
 */
await test('duplicate document ids are re-idled, not merged', async () => {
  const mk = name => ({
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: { fullName: name, children: [], beneficiaries: [], specificGifts: [], guardians: [] },
  });
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify([mk('Luke Holder'), mk('Sharon Ritchie-Keeble')]) });
  await storage.hydrateStorage();
  const list = storage.listWills();

  check('both wills survive sharing an id', list.length === 2, `got ${list.length}`);
  check('the duplicate is given a fresh id', list[0].id !== list[1].id);
  check('the FIRST holder keeps the id, so anything pointing at it still resolves',
    list.find(w => w.id === 'd1')?.title === 'Luke Holder');

  storage.deleteWill(list.find(w => w.title === 'Sharon Ritchie-Keeble').id);
  const after = storage.listWills();
  check('deleting the re-idled will leaves the other alone',
    after.length === 1 && after[0].title === 'Luke Holder',
    `got ${JSON.stringify(after.map(w => w.title))}`);
});

/**
 * Child ids are backfilled and de-duplicated. Beneficiaries hold a
 * `linkedPersonId` pointing at a child id, so two children sharing an id made
 * every linked reference collapse to whichever came first. The LATER duplicate
 * gets the fresh id, so existing links keep resolving to the row they already
 * resolved to.
 */
await test('duplicate child ids', async () => {
  const docs = [{
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: {
      fullName: 'Luke Holder',
      children: [
        { id: 'c1', name: 'Jacob', dob: '01/01/2023' },
        { id: 'c1', name: 'Keira', dob: '' },
        { name: 'Third', dob: '' },
      ],
      beneficiaries: [
        { id: 'b1', name: 'Jacob', percentage: '100', linkedPersonId: 'c1',
          substitution: { type: 'per-stirpes', substitutes: [] } },
      ],
      specificGifts: [], guardians: [],
    },
  }];
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const data = storage.loadWillData('d1');
  const ids = data.children.map(c => c.id);

  check('every child has an id after reopening',
    ids.every(id => typeof id === 'string' && id !== ''));
  check('no two children share an id', new Set(ids).size === ids.length,
    `got ${JSON.stringify(ids)}`);
  check('the FIRST child keeps the contested id, so the linked beneficiary still points at the same person',
    data.children[0].id === 'c1' && data.children[0].name === 'Jacob'
      && data.beneficiaries[0].linkedPersonId === 'c1');
});

/**
 * Booleans are `=== true`, never truthiness. The string 'false' — a shape a
 * JSON file from some other tool can easily hold — is truthy, and what that
 * produced in a FINAL will was a private individual declared "(a registered
 * charity)" and an adult's share held on trust until 18. A wrong operative
 * clause, not a crash.
 */
await test('string booleans do not become true', async () => {
  const docs = [{
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: {
      fullName: 'Luke Holder',
      isForSomeoneElse: 'true',
      childrenConfirmed: 'true',
      expectingMarriage: 'yes',
      children: [],
      beneficiaries: [
        { id: 'b1', name: 'Jane Smith', percentage: '100',
          isOwnChild: 'false', isMinor: 'false', isCharity: 'false',
          substitution: { type: 'per-stirpes', substitutes: [] } },
      ],
      specificGifts: [
        { id: 'g1', recipient: 'Amy Doyle', description: 'my watch', isCharity: 1 },
      ],
      guardians: [],
    },
  }];
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const data = storage.loadWillData('d1');
  const b = data.beneficiaries[0];

  check('the string "false" reopens as false on every beneficiary flag',
    b.isOwnChild === false && b.isMinor === false && b.isCharity === false);
  check('a truthy non-boolean on a gift does not make it a charity gift',
    data.specificGifts[0].isCharity === false);
  check('"confirmed my children are listed" cannot be answered by a string',
    data.childrenConfirmed === false);
  check('expectation of marriage cannot be switched on by a string',
    data.expectingMarriage === false);
  check('who the will is for is not flipped by a string',
    data.isForSomeoneElse === false);
});

/**
 * A gift's substitution type is whitelisted the same way a beneficiary's is.
 * `|| 'residue'` kept whatever string arrived, and the clause switch silently
 * ignored the named recipient — the gift fell into residue with the user
 * believing it went to the person they named.
 */
await test('gift substitution fields are whitelisted and typed', async () => {
  const docs = [{
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: {
      fullName: 'Luke Holder',
      children: [], beneficiaries: [], guardians: [],
      specificGifts: [
        { id: 'g1', recipient: 'Amy Doyle', description: 'my watch',
          substitutionType: 'quantum-entanglement', substitutionRecipient: 'Bob Doyle' },
        { id: 'g2', recipient: 'Rob Hughes', description: 'my car',
          substitutionType: 'named', substitutionRecipient: 42 },
      ],
    },
  }];
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const [g1, g2] = storage.loadWillData('d1').specificGifts;

  check('an unrecognised gift substitution type falls back to residue',
    g1.substitutionType === 'residue', `got ${JSON.stringify(g1.substitutionType)}`);
  check('a recognised type survives', g2.substitutionType === 'named');
  check('a legacy free-text recipient migrates to a one-entry alternatives list',
    g1.substitutionRecipients.length === 1 && g1.substitutionRecipients[0].name === 'Bob Doyle',
    `got ${JSON.stringify(g1.substitutionRecipients)}`);
  check('a non-string recipient is dropped, not concatenated into the will',
    Array.isArray(g2.substitutionRecipients) && g2.substitutionRecipients.length === 0,
    `got ${JSON.stringify(g2.substitutionRecipients)}`);
});

/**
 * An unrecognisable substitution TYPE alongside a legacy namedPerson means the
 * intent was plainly "to a named person". Falling back to per-stirpes with an
 * inoperative substitutes list rerouted the share to the beneficiary's issue
 * instead of the person the user named — exactly the silent re-routing the
 * migration promises never to do.
 */
await test('legacy namedPerson wins over an unknown type', async () => {
  const docs = [{
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: {
      fullName: 'Luke Holder',
      children: [],
      beneficiaries: [
        { id: 'b1', name: 'Sam', percentage: '60',
          substitution: { type: 'gibberish', namedPerson: 'Michael Doyle' } },
        { id: 'b2', name: 'Amy', percentage: '40',
          substitution: { type: 'named', namedPerson: 'Bob Doyle', substitutes: [] } },
      ],
      specificGifts: [], guardians: [],
    },
  }];
  const { storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const [a, b] = storage.loadWillData('d1').beneficiaries;

  check('an unknown type with a named person lands on "named", not per stirpes',
    a.substitution.type === 'named', `got ${JSON.stringify(a.substitution.type)}`);
  check('the named person becomes the sole substitute on the whole share',
    a.substitution.substitutes.length === 1
      && a.substitution.substitutes[0].name === 'Michael Doyle'
      && a.substitution.substitutes[0].share === '100');
  check('an empty substitutes list does not beat a populated namedPerson',
    b.substitution.substitutes.length === 1 && b.substitution.substitutes[0].name === 'Bob Doyle');
});

/**
 * Null scalars and fields from the future.
 *
 * The old `{...EMPTY_WILL, ...parsed}` merge meant an explicit `null` in the
 * file overrode the default and reached screens that call `.trim()` — one
 * `fullName: null` bricked the Home screen for every will. And a field written
 * by a NEWER build has to ride through a save from this one, or updating the
 * app backwards deletes answers.
 */
await test('null scalars and unknown fields', async () => {
  const docs = [{
    id: 'd1', step: 0, createdAt: 1, updatedAt: 1,
    data: {
      fullName: null, address: null, dob: null,
      maritalStatus: 'polyamorous', burialPreference: 'viking',
      funeralWishes: 12345,
      fieldFromTheFuture: 'kept intact',
      children: [], beneficiaries: [{ id: 'b1', name: 'Jane', percentage: 50 }],
      specificGifts: [], guardians: [],
    },
  }];
  const { store, storage } = freshStorage({ [DOCS_KEY]: JSON.stringify(docs) });
  await storage.hydrateStorage();
  const data = storage.loadWillData('d1');

  check('null scalars reopen as empty strings, not nulls',
    data.fullName === '' && data.address === '' && data.dob === '');
  check('an unrecognised marital status is blanked so the question gets asked again',
    data.maritalStatus === '' && data.burialPreference === '');
  check('a number where prose belongs is blanked, not printed',
    data.funeralWishes === '');
  check('a numeric percentage is converted, not blanked',
    data.beneficiaries[0].percentage === '50');
  check('a field this build does not know survives reopening',
    data.fieldFromTheFuture === 'kept intact');

  // The round trip that matters: save from THIS build, reopen, and the future
  // field is still there.
  storage.saveWillData('d1', { ...data, fullName: 'Luke Holder' });
  await storage.flushWill();
  const reopened = freshStorage(Object.fromEntries(store.map));
  await reopened.storage.hydrateStorage();
  const after = reopened.storage.loadWillData('d1');
  check('a field from a newer build survives being saved by this one',
    after.fieldFromTheFuture === 'kept intact' && after.fullName === 'Luke Holder',
    `got ${JSON.stringify(after.fieldFromTheFuture)}`);
});

console.log(`\n${ran} checks, ${ran - failures} passed, ${failures} failed.`);
if (failures) process.exitCode = 1;
