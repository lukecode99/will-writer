import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WillData, EMPTY_WILL, Beneficiary, BeneficiarySubstitution, Guardian, SpecificGift,
  GiftSubstitute, GiftRecipient, GiftSubstitutionType, Substitute, SubstitutionType, Child, Executor,
} from './types';

const DOCS_KEY = 'willWriter.docs.v1';
const CORRUPT_KEY = 'willWriter.docs.v1.corrupt';

// The single-will keys this app used before it could hold more than one. Read
// once, at migration, and then left alone: nothing writes to them again, so a
// build that has to be rolled back still finds the draft it left behind.
const LEGACY_KEY = 'willWriter.v1';
const LEGACY_STEP_KEY = 'willWriter.step.v1';

export interface WillDoc {
  id: string;
  data: WillData;
  /** The wizard step this will was last left on. */
  step: number;
  createdAt: number;
  updatedAt: number;
}

/** What the home screen needs to draw the list, without the whole will. */
export interface WillSummary {
  id: string;
  title: string;
  isForSomeoneElse: boolean;
  updatedAt: number;
  step: number;
}

/**
 * The drafts used to be read straight out of `window.localStorage`. On iOS
 * `window` exists but `window.localStorage` does not, so every read threw, the
 * catch swallowed it, and the app would have opened on a blank will every
 * launch while still appearing to save normally -- a silent data loss rather
 * than a visible error. AsyncStorage works on both platforms (it is backed by
 * localStorage on web, so web behaviour is unchanged).
 *
 * AsyncStorage is async, but a draft is read in a `useState` initialiser and
 * written from inside a state updater across eight screens. Rather than make
 * all of those async, the store is read into memory once at startup by
 * `hydrateStorage()` and reads are served from that copy; writes update the
 * copy immediately and flush to disk in the background.
 *
 * All the wills live under one key. That keeps a flush atomic -- there is no
 * window in which the list of wills disagrees with the wills themselves -- and
 * at this size (a handful of documents, a few KB each) rewriting the lot on a
 * keystroke costs nothing.
 */
let docs: WillDoc[] = [];
let hydrated = false;

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const SUBSTITUTION_TYPES: SubstitutionType[] = ['per-stirpes', 'named', 'pro-rata', 'own-children'];
const MARITAL_STATUSES = ['single', 'married', 'civilPartnership', 'divorced', 'widowed'];
const BURIAL_PREFERENCES = ['burial', 'cremation', 'noPreference'];

/**
 * A string, or nothing. `name || ''` let a number through — `fullName: 12345`
 * crashed the Home screen for every will, because everything downstream calls
 * `.trim()` on what this file hands out. These values also go straight into
 * the operative words of a document, so the only types allowed out of here are
 * the types the rest of the app was written against.
 */
function str(v: any): string {
  return typeof v === 'string' ? v : '';
}

/** A percentage may have been stored as a number by some other build; that is
 * losslessly a string, unlike a name, so it is converted rather than blanked. */
function numericStr(v: any): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return str(v);
}

function asObjectArray(value: any): any[] {
  return Array.isArray(value) ? value.filter(el => el && typeof el === 'object') : [];
}

/**
 * A substitution type this build does not recognise falls back to per stirpes.
 *
 * Adding a fourth substitution type made this reachable for the first time.
 * Wills are saved by one version of the app and reopened by another, and the
 * traffic runs both ways: a will written on a phone that has updated gets
 * opened on one that has not, and old builds stay installed for a long time.
 *
 * The unknown string used to be stored as-is and handed to the clause switch,
 * which matches no branch and returns undefined — a will with the substitution
 * paragraph missing entirely, and no error, no gap marker and nothing on the
 * review screen to say so. The one failure this app cannot afford is the silent
 * one, because the document looks finished either way.
 *
 * Per stirpes is the right thing to land on because it is what a new
 * beneficiary starts as, so the fallback is the app's own default rather than a
 * choice made quietly on the user's behalf. It is still a changed provision,
 * but a visible one: it shows on the residuary screen and in the preview, where
 * it can be seen and put back.
 */
function normalizeSubstitution(sub: any): BeneficiarySubstitution {
  // When the stored type is unrecognisable but a legacy namedPerson is there,
  // the intent was plainly "to a named person" — falling back to per-stirpes
  // with an inoperative substitutes list rerouted the share to the
  // beneficiary's issue instead of the person the user named, which is exactly
  // the silent re-routing this migration promises never to do.
  const legacyNamed = typeof sub?.namedPerson === 'string' && sub.namedPerson.trim() !== '';
  const type: SubstitutionType = SUBSTITUTION_TYPES.includes(sub?.type)
    ? sub.type
    : legacyNamed ? 'named' : 'per-stirpes';

  // Whitelisted like the type: only the explicit new value counts. Every draft
  // saved before the field existed — and any corrupted value — lands on
  // 'survivors', which is what the clause did before there was a choice, so
  // reopening an old will cannot quietly reroute a substitute's part.
  const namedFallback = sub?.namedFallback === 'issue' ? 'issue' as const : 'survivors' as const;

  // A list of substitutes, from a build that has one.
  //
  // Typed rather than trusted at every field: these are concatenated straight
  // into a sentence of the will, so a number where a name should be becomes a
  // number in the document, and a share that is not a string reaches a parser
  // that expects one. An empty list falls through — a corrupted mix of an
  // empty `substitutes` and a populated `namedPerson` should still find the
  // name rather than an inoperative list.
  if (Array.isArray(sub?.substitutes)) {
    const substitutes: Substitute[] = sub.substitutes
      .filter((s: any) => s && typeof s === 'object')
      .map((s: any) => ({
        id: typeof s.id === 'string' && s.id ? s.id : Math.random().toString(36).slice(2),
        name: str(s.name),
        share: numericStr(s.share),
        address: str(s.address),
      }));
    if (substitutes.length > 0 || !legacyNamed) return { type, substitutes, namedFallback };
  }

  // A draft saved before substitutes could be a list, when the field was one
  // free-text `namedPerson`.
  //
  // It migrates to a single entry taking the whole of that beneficiary's share,
  // which is what the old document said: "shall pass to X absolutely", no
  // apportionment because there was nothing to apportion between. The clause
  // generator emits exactly that wording for a one-entry list, so an old draft
  // reopened here and regenerated produces the same words it did before.
  //
  // Deliberately not parsed. Someone who typed "Jacob and Keira in equal
  // shares" into that box has two substitutes in mind, and splitting the string
  // would look like the app understanding that — but "Jacob and Keira" is also
  // how a charity or a couple taking jointly gets typed, and guessing wrong
  // rewrites who inherits. It comes back as one entry reading exactly what they
  // wrote, on a screen that now shows it in a list with a share box beside it,
  // where the ambiguity is visible and theirs to resolve.
  if (typeof sub?.namedPerson === 'string' && sub.namedPerson.trim()) {
    return {
      type,
      substitutes: [{ id: Math.random().toString(36).slice(2), name: sub.namedPerson, share: '100', address: '' }],
      namedFallback,
    };
  }

  return { type, substitutes: [], namedFallback };
}

/**
 * Booleans are `=== true`, never `?? false`. The string 'false' — a shape a
 * JSON file from some other tool can easily hold — survives `?? false` as
 * truthy, and what that produced in a FINAL will was a private individual
 * declared "(a registered charity)" and an adult spouse's share "held on
 * trust until age 18". A wrong operative clause, not a crash.
 */
function normalizeBeneficiary(b: any): Beneficiary {
  return {
    id: typeof b.id === 'string' && b.id ? b.id : Math.random().toString(36).slice(2),
    name: str(b.name),
    relationship: str(b.relationship),
    percentage: numericStr(b.percentage),
    isOwnChild: b.isOwnChild === true,
    isMinor: b.isMinor === true,
    isCharity: b.isCharity === true,
    substitution: normalizeSubstitution(b.substitution),
    // Drafts saved before beneficiaries could be picked from the family details
    // reopen unlinked, which is what they are: names typed by hand. They carry
    // on being matched by name, exactly as they were. Inventing a link by
    // guessing from the spelling is the failure this field exists to remove.
    linkedPersonId: str(b.linkedPersonId),
  };
}

function normalizeGift(g: any): SpecificGift {
  // A legacy free-text alternative, from a build before the gift's substitute
  // was a list.
  const legacyRecipient = typeof g.substitutionRecipient === 'string' && g.substitutionRecipient.trim() !== '';

  // A legacy single primary recipient, from a build before a gift could be
  // given to several people jointly.
  const legacyPrimary = typeof g.recipient === 'string' && g.recipient.trim() !== '';

  // Whitelisted: only the explicit known values count. 'per-stirpes' and 'named'
  // survive; everything else falls to 'residue'. Unlike a beneficiary share —
  // where the default (per-stirpes) silently rerouted to issue, so an unknown
  // type with a legacy name had to be promoted to 'named' to preserve intent —
  // a gift's default is residue, which loses nothing: the gift simply stays in
  // the estate. So there is no promotion to make here, and the safe default is
  // genuinely safe.
  const substitutionType: GiftSubstitutionType =
    g.substitutionType === 'named' || g.substitutionType === 'per-stirpes'
      ? g.substitutionType
      : 'residue';

  // Whitelisted like the residuary fallback: only the explicit new value counts,
  // everything else lands on 'survivors' — what the clause did before there was
  // a choice — so reopening an old gift cannot quietly reroute an alternative's
  // part to children the testator never named.
  const substitutionFallback = g.substitutionFallback === 'issue' ? 'issue' as const : 'survivors' as const;

  // The list of named alternatives, from a build that has one. Typed at every
  // field because these concatenate straight into a sentence of the will.
  let substitutionRecipients: GiftSubstitute[] = [];
  if (Array.isArray(g.substitutionRecipients)) {
    substitutionRecipients = g.substitutionRecipients
      .filter((s: any) => s && typeof s === 'object')
      .map((s: any) => ({
        id: typeof s.id === 'string' && s.id ? s.id : Math.random().toString(36).slice(2),
        name: str(s.name),
        address: str(s.address),
      }));
  }
  // A draft saved before the alternative was a list migrates its single
  // free-text name to a one-entry list — unparsed, exactly as typed — the same
  // way a residuary namedPerson does. An empty list with a legacy name present
  // still finds the name rather than reopening as an inoperative list.
  if (substitutionRecipients.length === 0 && legacyRecipient) {
    substitutionRecipients = [{ id: Math.random().toString(36).slice(2), name: g.substitutionRecipient, address: '' }];
  }

  // The primary recipients, typed the same way as the alternatives above. A
  // draft saved before the recipient was a list migrates its single free-text
  // name to a one-entry list, so reopening an old gift keeps the same person.
  let recipients: GiftRecipient[] = [];
  if (Array.isArray(g.recipients)) {
    recipients = g.recipients
      .filter((r: any) => r && typeof r === 'object')
      .map((r: any) => ({
        id: typeof r.id === 'string' && r.id ? r.id : Math.random().toString(36).slice(2),
        name: str(r.name),
        address: str(r.address),
      }));
  }
  if (recipients.length === 0 && legacyPrimary) {
    recipients = [{ id: Math.random().toString(36).slice(2), name: g.recipient, address: '' }];
  }

  return {
    id: typeof g.id === 'string' && g.id ? g.id : Math.random().toString(36).slice(2),
    recipients,
    description: str(g.description),
    isCharity: g.isCharity === true,
    // Drafts saved before the tax choice existed had "free of inheritance tax"
    // hardcoded onto every gift. They reopen on the safer default instead, and
    // the user is shown the choice on the Specific Gifts screen.
    taxBurden: g.taxBurden === 'freeOfTax' ? 'freeOfTax' : 'bearsOwnTax',
    substitutionType,
    substitutionRecipients,
    substitutionFallback,
  };
}

function normalizeGuardian(g: any): Guardian {
  return {
    id: typeof g.id === 'string' && g.id ? g.id : Math.random().toString(36).slice(2),
    name: str(g.name),
    address: str(g.address),
    // Drafts saved before the split appointed every guardian jointly. They
    // reopen as all-primary, which is the same appointment they already had:
    // reopening a will must not quietly change who it appoints.
    role: g.role === 'substitute' ? 'substitute' : 'primary',
  };
}

/**
 * Child ids are backfilled and de-duplicated. Beneficiaries hold a
 * `linkedPersonId` pointing at a child id, so two children sharing an id made
 * every linked reference collapse to whichever came first — a beneficiary
 * stored as one child was rewritten to another by the sync, and edits and
 * removals fanned out across the id-sharing rows. A backfilled id breaks no
 * link (nothing links to ''), and re-idling the LATER duplicate keeps existing
 * links resolving to the same row they already resolved to.
 */
function normalizeChild(c: any, seenIds: Set<string>): Child {
  let id = typeof c.id === 'string' && c.id ? c.id : '';
  if (!id || seenIds.has(id)) id = Math.random().toString(36).slice(2);
  seenIds.add(id);
  return {
    id,
    name: str(c.name),
    dob: str(c.dob),
  };
}

function normalizeExecutor(e: any): Executor {
  return {
    name: str(e?.name),
    address: str(e?.address),
  };
}

/**
 * Every known field is rebuilt explicitly; unknown fields ride along untouched.
 *
 * The old `{...EMPTY_WILL, ...parsed}` merge meant an explicit `null` in the
 * file overrode the default and reached screens that call `.trim()` — one
 * `fullName: null` bricked the Home screen for every will. Children, the three
 * executors and all the scalars were never normalized at all. The spread of
 * `p` FIRST is what keeps a field written by a newer build alive across a save
 * from this one.
 */
function normalizeWill(parsed: any): WillData {
  const p = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const seenChildIds = new Set<string>();
  return {
    ...p,
    // Drafts saved before the home screen existed were all the user's own will.
    isForSomeoneElse: p.isForSomeoneElse === true,
    fullName: str(p.fullName),
    address: str(p.address),
    dob: str(p.dob),
    maritalStatus: MARITAL_STATUSES.includes(p.maritalStatus) ? p.maritalStatus : '',
    partnerName: str(p.partnerName),
    partnerAddress: str(p.partnerAddress),
    children: asObjectArray(p.children).map(c => normalizeChild(c, seenChildIds)),
    // A draft written before the question existed was never asked it. Only an
    // explicit true counts — anything else reopens unconfirmed and asks.
    childrenConfirmed: p.childrenConfirmed === true,
    primaryExecutor: normalizeExecutor(p.primaryExecutor),
    secondaryExecutor: normalizeExecutor(p.secondaryExecutor),
    secondaryExecutorRole:
      p.secondaryExecutorRole === 'joint' || p.secondaryExecutorRole === 'substitute'
        ? p.secondaryExecutorRole
        : '',
    backupExecutor: normalizeExecutor(p.backupExecutor),
    guardians: asObjectArray(p.guardians).map(normalizeGuardian),
    specificGifts: asObjectArray(p.specificGifts).map(normalizeGift),
    beneficiaries: asObjectArray(p.beneficiaries).map(normalizeBeneficiary),
    ultimateBackstop: str(p.ultimateBackstop),
    funeralWishes: str(p.funeralWishes),
    burialPreference: BURIAL_PREFERENCES.includes(p.burialPreference) ? p.burialPreference : '',
    expectingMarriage: p.expectingMarriage === true,
    intendedSpouseName: str(p.intendedSpouseName),
  };
}

function normalizeDoc(d: any, index: number): WillDoc {
  const now = Date.now();
  return {
    id: typeof d?.id === 'string' && d.id ? d.id : `recovered-${index}-${newId()}`,
    data: normalizeWill(d?.data),
    step: Number.isFinite(d?.step) ? Math.max(0, Math.floor(d.step)) : 0,
    createdAt: Number.isFinite(d?.createdAt) ? d.createdAt : now,
    updatedAt: Number.isFinite(d?.updatedAt) ? d.updatedAt : now,
  };
}

/**
 * Reads the saved drafts into memory. Must finish before the first render:
 * otherwise the user is shown an empty form over the top of a saved will, and
 * the first keystroke overwrites it.
 */
export async function hydrateStorage(): Promise<void> {
  if (hydrated) return;
  try {
    const [[, rawDocs], [, legacyWill], [, legacyStep]] = await AsyncStorage.multiGet([
      DOCS_KEY,
      LEGACY_KEY,
      LEGACY_STEP_KEY,
    ]);

    if (rawDocs) {
      let parsed: any;
      try {
        parsed = JSON.parse(rawDocs);
      } catch (err) {
        // Do not quietly start from nothing on top of something unreadable.
        // Park the bytes where they can still be recovered, and say so.
        console.warn('The saved wills could not be parsed; keeping a copy', err);
        AsyncStorage.setItem(CORRUPT_KEY, rawDocs).catch(() => {});
        parsed = null;
      }
      // Each will normalizes inside its own try/catch. One malformed element
      // used to throw out of the shared map into the outer catch, which set
      // docs = [] — every HEALTHY will gone from the list, and the next write
      // persisted the wipe while the Save button reported success. A bad doc
      // is parked where it can be recovered; its siblings survive.
      const good: WillDoc[] = [];
      const bad: any[] = [];
      const seenDocIds = new Set<string>();
      asObjectArray(parsed).forEach((d, index) => {
        try {
          const doc = normalizeDoc(d, index);
          // Two wills sharing an id made deleting one delete both — deleteWill
          // filters by id. Re-idling the later duplicate keeps both.
          if (seenDocIds.has(doc.id)) doc.id = `recovered-${index}-${newId()}`;
          seenDocIds.add(doc.id);
          good.push(doc);
        } catch (err) {
          console.warn('One saved will could not be read; keeping a copy', err);
          bad.push(d);
        }
      });
      if (bad.length > 0) {
        AsyncStorage.setItem(CORRUPT_KEY, JSON.stringify(bad)).catch(() => {});
      }
      docs = good;
    } else if (legacyWill) {
      // One saved will from before this screen existed. It is the user's own.
      const n = legacyStep ? parseInt(legacyStep, 10) : 0;
      const now = Date.now();
      docs = [{
        id: newId(),
        data: normalizeWill(JSON.parse(legacyWill)),
        step: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0,
        createdAt: now,
        updatedAt: now,
      }];
      await AsyncStorage.setItem(DOCS_KEY, JSON.stringify(docs));
    } else {
      docs = [];
    }
  } catch (err) {
    // An unreadable store must not stop the app opening.
    console.warn('Could not read the saved wills', err);
    docs = [];
  }
  hydrated = true;
}

/**
 * Autosave runs behind a keystroke, so a failure has no screen of its own to
 * appear on — which is how a full disk used to look exactly like a working
 * save for as long as the app stayed open. The app registers here to hear
 * about a run of failures; a call with 0 announces recovery so the listener
 * can re-arm.
 */
let persistFailureListener: ((consecutiveFailures: number) => void) | null = null;
let persistFailures = 0;

export function onPersistFailure(
  listener: ((consecutiveFailures: number) => void) | null,
): void {
  persistFailureListener = listener;
}

function persist(): void {
  AsyncStorage.setItem(DOCS_KEY, JSON.stringify(docs))
    .then(() => {
      if (persistFailures > 0) {
        persistFailures = 0;
        if (persistFailureListener) persistFailureListener(0);
      }
    })
    .catch(err => {
      // There is nothing useful to show the user mid-keystroke, and the
      // in-memory copy is still correct, but an unhandled rejection would take
      // the whole app down.
      console.warn('Could not save the will', err);
      persistFailures += 1;
      if (persistFailureListener) persistFailureListener(persistFailures);
    });
}

function find(id: string): WillDoc | undefined {
  return docs.find(d => d.id === id);
}

/** Most recently edited first — the one you are most likely to want. */
export function listWills(): WillSummary[] {
  return [...docs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(d => ({
      id: d.id,
      title: d.data.fullName.trim(),
      isForSomeoneElse: d.data.isForSomeoneElse,
      updatedAt: d.updatedAt,
      step: d.step,
    }));
}

export function createWill(isForSomeoneElse: boolean): string {
  const now = Date.now();
  const doc: WillDoc = {
    id: newId(),
    data: { ...EMPTY_WILL, isForSomeoneElse },
    step: 0,
    createdAt: now,
    updatedAt: now,
  };
  docs.push(doc);
  persist();
  return doc.id;
}

export function loadWillData(id: string): WillData {
  const doc = find(id);
  // A DEEP copy. The shallow one shared its nested arrays and objects with the
  // persistent store, so a mutation in a screen was a mutation of the saved
  // will — latent, because the screens happen to replace rather than mutate
  // today. JSON round-trip rather than structuredClone: Hermes.
  return JSON.parse(JSON.stringify(doc ? doc.data : EMPTY_WILL));
}

export function saveWillData(id: string, data: WillData): void {
  const doc = find(id);
  if (!doc) return;
  doc.data = data;
  doc.updatedAt = Date.now();
  persist();
}

export function deleteWill(id: string): void {
  docs = docs.filter(d => d.id !== id);
  persist();
}

export function loadStep(id: string): number {
  return find(id)?.step ?? 0;
}

export function saveStep(id: string, step: number): void {
  const doc = find(id);
  if (!doc) return;
  doc.step = step;
  persist();
}

/**
 * Writes every draft and waits for it to land, then reads it back to check it
 * is really there.
 *
 * Everything else in this file is fire-and-forget: `persist` swallows failures
 * because there is nothing useful to say to someone mid-keystroke. That is fine
 * for autosave and useless as a promise to the user, so the Save button uses
 * this instead -- it can fail out loud. The read-back matters because
 * `setItem` resolving only means the native module accepted the write; on a
 * device with no space left it can still resolve and store nothing.
 */
export async function flushWill(): Promise<void> {
  const payload = JSON.stringify(docs);
  await AsyncStorage.setItem(DOCS_KEY, payload);
  const back = await AsyncStorage.getItem(DOCS_KEY);
  if (back !== payload) {
    throw new Error('The draft was written but could not be read back');
  }
}
