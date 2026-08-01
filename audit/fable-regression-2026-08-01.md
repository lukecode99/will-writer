# Will Writer — Full Adversarial Regression (Fable pass, 1 Aug 2026)

Scope: design, inputs, UX, PDF output, drafting quality, persistence. Method: full read of
pdfGen.ts / validation.ts / types.ts / family.ts / text.ts / people.ts / storage.ts + every screen;
hostile fixtures driven through the REAL `generateWillPdf` (probe scripts at /tmp/fable-probe*.mjs,
/tmp/ww-probe*.mjs); every finding below marked **[reproduced]** was observed in actual generator
output or storage behaviour, not inferred.

Baseline first: all existing suites green — audit/run.mjs 61/61, people-test 60/60,
storage-test 35/35. Everything below is a gap the suites do not cover.

Root causes (fix these and most of the list closes):
- **R1 — Five rules live only in screens' Continue buttons, not `blockingProblems()`**: empty DOB,
  marital status, guardian names / orphan substitutes, executor address-without-name, child DOB
  validity. Review's Edit links + draft-resume make every screen-only rule bypassable. The
  codebase's own design rule ("ALL hard rules live in blockingProblems") is violated five times.
- **R2 — The substitution scheme has no per-branch gap-closer for 'named', and the ultimate
  backstop is whole-estate-conditioned**, so single-branch failure falls into intestacy.
- **R3 — `normalizeWill` trusts shapes it doesn't own**: no typeof guards on strings, `?? false`
  on booleans, unmapped children/executors/scalars, no per-doc try/catch.

---

## CRITICAL — a wrong or invalid will is generated, or user data is destroyed

**C1. Partial intestacy — named substitutes have no fallback. [reproduced]**
Generated verbatim: *"(a) If Alice Adams (50%) shall fail to survive me by 30 days, Alice Adams's
share shall pass to Simon Sub absolutely."* Full stop. If Simon has also died, that 50% is
undisposed of — the ultimate backstop reads *"If **no residuary beneficiary or their substituted
beneficiary** shall survive me by 30 days…"*, so it cannot fire while Bob Brown (the other 50%)
survives. Result: half the estate on intestacy, from a will that reads complete. Identical hole
when ALL of multiple named substitutes fail (the cross-accruer only redistributes among the
substitutes themselves). The code comment at pdfGen.ts ~285 claims the ultimate clause catches
this — it does not.
Also inconsistent: the gift over to a named substitute carries **no 30-day survivorship
condition** — a substitute who survives the testator by a day takes absolutely and it passes
through *their* estate, unlike every other taker in the scheme.
**Fix:** append a gap-closer to every named branch ("and if no such substitute shall so survive
me, that share shall be divided among the other surviving residuary beneficiaries…"), apply the
30-day condition to substitutes, and re-condition the backstop per-share rather than whole-estate.

**C2. Pro-rata variant of C1. [reproduced]**
"…divided among the other **surviving residuary beneficiaries**" — a substitute taking another
beneficiary's share is not a "surviving residuary beneficiary", and their survival BLOCKS the
backstop. Two-beneficiary will where one is pro-rata and the other's named substitute takes →
pro-rata share intestate.

**C3. Age gate bypass — empty DOB generates a FINAL will. [reproduced]**
validation.ts only checks the DOB when it is non-empty; blank → no blocking problem, no warning,
non-draft generation succeeds, revocation clause silently omits "born on…", Home labels it "Ready
to print and sign". The Wills Act 1837 s.7 under-18 rule is enforced nowhere on this path. Route
is real: reopen a draft saved past step 0, or leave About You via a Review Edit link without
pressing Continue. `01/01/1900` (age 126) also generates clean.
**Fix:** add empty-DOB (and >120y) to blockingProblems.

**C4. Blank guardian name prints into a final will; substitute-only guardians vanish. [reproduced]**
Generated verbatim in a strict, un-watermarked will: *"I appoint [GUARDIAN NAME MISSING] of
3 Guard St to be the guardian(s) of my minor children."* And with only a substitute guardian
listed (no primary), the guardian clause is omitted entirely — an appointment the user typed is
silently deleted. Both rules exist only on the Guardians screen (R1).

**C5. One malformed element in storage wipes EVERY saved will — and Save reports success. [reproduced]**
storage.ts hydrate: normalize failures fall to the catch that sets `docs = []`; the corrupt-parking
branch only covers JSON.parse. One `null` in any doc's beneficiaries/gifts/guardians array →
`listWills()` = [] including healthy wills; first subsequent write persists the wipe; `flushWill`'s
read-back then verifies the wiped payload, so the Save button shows success while the data is
destroyed. This is precisely the failure storage.ts's own comments call unaffordable.
**Fix:** per-doc try/catch inside the map (park bad doc under CORRUPT_KEY, siblings survive),
Array.isArray + object-filter before every `.map`.

**C6. String "false" booleans → false operative words in a final will. [reproduced]**
`isCharity: 'false'` / `isMinor: 'false'` survive `?? false` normalisation as truthy. Observed in
strict output: a private individual declared *"(a registered charity)"* with treasurer-receipt
wording, and an adult spouse's share *"held on trust until age 18"* with full trust machinery.
Generator renders wrong rather than refusing. **Fix:** `=== true` in the normalizers.

---

## HIGH — defective drafting or app-bricking

**H1. Charity as residuary beneficiary → nonsense operative text. [reproduced]**
No isCharity concept on residuary beneficiaries, so default per-stirpes produces: *"Cancer
Research UK's share shall pass in equal shares to Cancer Research UK's children then living…"*.
The trigger is also wrong for a company ("fail to survive me by 30 days" — pdfGen already uses
"ceased to exist or amalgamated" for charity GIFTS, so the right wording exists in the file).
No charity-number capture anywhere (gifts print "(a registered charity)" on the user's say-so).
**Fix:** isCharity flag on residuary beneficiaries + backstop, suppress family-substitution types
for them, use the ceased-to-exist trigger, collect registered charity numbers.

**H2. Attestation witness labels omit civil partner. [reproduced]**
Printed: "must not be a beneficiary or spouse of a beneficiary". s.15 Wills Act 1837 (as extended
by CPA 2004) also voids a gift where the witness is a beneficiary's CIVIL PARTNER. The signing-
instructions page states it correctly — the label at the actual signature line doesn't.

**H3. Own-children substitution: 30-day window disinherits a dead child's family. [reproduced]**
Class = *"such of my children as shall survive me by 30 days"*; grandchild limb = *"if any child
of mine shall have **predeceased me**…"*. A child who survives the testator but dies on day 10,
leaving children, is in neither limb — their branch's share silently redistributes to the other
children instead of their kids. **Fix:** key the grandchild limb to "failed to survive me by 30
days" rather than "predeceased me".

**H4. Per-stirpes clause: same window bug plus ambiguity.**
*"children then living"* — then = when? (death? expiry of 30 days?). And the grandchild limb is
keyed to predeceasing the BENEFICIARY, so a grandchild whose parent survived the beneficiary but
predeceased the testator is in neither limb. Same fix pattern as H3.

**H5. Marital status never required centrally; blank status kills the safety net.**
Not in blockingProblems or warnings. With status '': no family declaration clause at all, the
disinherited-spouse / 1975 Act warning cannot fire, and a spouse can be recited as "partner".

**H6. Second-executor clause is ambiguous on its face.**
*"to be Executor jointly with or as a substitute for the above"* — the will never says which;
that's a construction dispute at probate. The guardians section already does joint-vs-substitute
properly. **Fix:** one radio question, two unambiguous clauses.

**H7. Null/numeric fields in storage crash the whole app. [reproduced]**
`fullName: null` bricks the Home screen for ALL wills; `children: null` crashes Family, Residuary
and Review; numeric name/percentage crash warnings() and generation. children, executors and all
scalars are never normalized; `{...EMPTY_WILL, ...parsed}` lets explicit null override defaults.

---

## MEDIUM

**M1. Minor-trust clause (d) points at machinery that can't operate.** *"If such beneficiary dies
before attaining 18, their share shall pass in accordance with the substitution provisions set out
above"* — but those provisions are all conditioned on "fail to survive me by 30 days". A minor who
survives 30 days then dies at 10 is outside their words. Fix: "as if that beneficiary had failed
to survive me by 30 days".
**M2. Gift substitute can be the recipient. [reproduced]** *"If Rita Recipient shall fail to
survive me by 30 days, this gift shall pass to Rita Recipient absolutely."* No validation; named
gift substitutes also carry no survivorship condition or further fallback.
**M3. Garbage child DOB prints the child with no date of birth in the declaration. [reproduced]**
"99/99/9999" passes generation (screen-only rule, R1) and the declaration's identifying detail is
silently dropped.
**M4. childrenConfirmed bypassable at generation** — a brand-new will can generate with the
completeness confirmation never ticked (Edit-link route falsifies the code comment's "unreachable").
**M5. Under-18 toggle never explains its consequence** — flipping it creates a trust-to-18 and the
user is told nothing unless a contradiction fires; conversely an un-flagged true minor gets no
trust and no warning unless matched by name/link.
**M6. Legacy `namedPerson` migration reroutes silently. [reproduced]** Old draft with
`{namedPerson:'Xavier'}` and no/corrupt `type` → per-stirpes with an inoperative substitutes list:
the share goes to the beneficiary's issue instead of Xavier, exactly the silent re-routing the
migration comments promise never to do.
**M7. Child id collapse moves inheritance between children. [reproduced]** Missing/duplicate child
ids → linked refs collapse to the first match; a beneficiary stored as Beth was observed rewritten
to Alice by syncLinkedBeneficiaries; updateChild/removeChild fan out across id-sharing rows.
**M8. Duplicate doc ids: deleting one will deletes both. [reproduced]**
**M9. Unknown gift substitutionType silently becomes residue. [reproduced]** `'quantum'` +
recipient → recipient ignored, residue wording, no marker (the gift path lacks the whitelist the
beneficiary path has).
**M10. Long unbroken word renders OFF-PAGE. [reproduced]** 300-char name → 7 draws at x=−894;
text silently lost on the printed will (wrapParagraph splits on spaces only; centered title goes
negative).

---

## LOW / UX polish

- Review shows raw enum values: "civilPartnership", "noPreference" — on the read-back screen.
- Marriage-revocation / witness rules only in Home's collapsed guide; Review says nothing before
  generation.
- One-tap Remove on every row (child/guardian/gift/beneficiary/substitute) with no confirm.
- AboutYou errors computed only on Continue (stale while fixing); other screens validate live.
- DOB fields use iOS-only keyboardType; 'number-pad' strictly better (formatter inserts slashes).
- "Print & post service" stub runs full generation then announces it's unwired.
- Second/backup executor forms can never be collapsed once opened.
- loadWillData returns a shallow copy — nested arrays alias the persistent store (latent).
- Legacy step key not clamped (docs path is).
- Autosave failures only console.warn — no escalation banner after N consecutive failures.

## Drafting improvements (not defects)

- **"In expectation of marriage" clause option** (s.18: marriage REVOKES the will). The app never
  asks "are you getting married?" — for anyone marrying after signing, the whole document silently
  dies. One question + one saving clause fixes it; at minimum the Review screen should warn.
- Charity merger/successor clause for charity gifts (beyond "amalgamated").
- STEP-standard survivorship consistency: apply the 30-day condition uniformly to every taker
  (substitutes currently exempt — see C1).
- Consider capturing charity registration numbers (H1) and executor relationship (aids probate).

## Verified sound (attack failed)

Share-total strictness (99.99% refused), strict percentage parsing shared screen/PDF, sanitiser +
WinAnsi transliteration, gift lettering past 26, blank-scalar [MARKER] + draft watermark
defence-in-depth, 30-day wording consistency screen↔PDF, free-of-tax abatement wording, guardian
joint/substitute drafting, forward-compatible storage of unknown fields, flushWill read-back on the
explicit Save path, hasMinorChildren failing open, date auto-slash logic.
