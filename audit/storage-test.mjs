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
        { id: 'b2', name: 'Amy Doyle', percentage: '30', substitution: { type: 'quantum-entanglement', namedPerson: 'Bob' } },
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
  check('an unrecognised substitution falls back to the default, not to nothing',
    b.substitution.type === 'per-stirpes');
  // This value is concatenated straight into a sentence of the will, so a
  // number here becomes a number in the document.
  check('a named person that is not a string is not concatenated into the will',
    c.substitution.namedPerson === '');
});

console.log(`\n${ran} checks, ${ran - failures} passed, ${failures} failed.`);
if (failures) process.exitCode = 1;
