# Print and post — design

Status: **design, not built.** Everything below that needs a credential is
listed at the bottom under "What Luke has to do"; nothing in that list can be
done from my container.

## What the feature is

The user finishes their will in the app, taps **Print & post**, pays, and a
printed pack arrives at their address a couple of days later. They sign it in
front of two witnesses. That is the whole product — the app is free, this is
the thing that earns.

## The constraint that shapes the design

The PDF is generated **on the device**. There is no server anywhere in this app
that has ever seen a will, and that is worth keeping: a will contains the
testator's name, address and date of birth, the names of their children, who
they are married to, who gets what, and the names and addresses of their
executors and guardians. It is other people's personal data as well as the
customer's.

To post it, the document has to leave the device once. The design goal is that
it leaves once, passes straight through to the printer, and is never at rest on
anything we own.

Two ways to do that:

- **(A) Pay first, then upload.** The app creates a Stripe Checkout session
  with no document attached. After payment it uploads the PDF in a single
  request; the worker verifies the session is paid, streams the bytes to the
  print provider, and returns. The will exists in our infrastructure only for
  the duration of one HTTP request. Nothing is stored, so nothing has to be
  deleted, so there is no retention policy to get wrong.
- **(B) Upload first, pay second.** Simpler for the user if they close the app
  mid-flow, but it means parking the PDF in R2 between the upload and the
  Stripe webhook, which means object lifecycle rules, encryption at rest, a
  retention statement, and a bucket that will eventually be misconfigured.

**Recommendation: (A).** The failure mode of (A) is a user who pays and then
closes the app before the upload completes. That is recoverable and cheap:
persist the paid session id locally, show a "your payment went through — tap to
send your will" banner on next open, and auto-refund any session that is still
unclaimed after 7 days. The failure mode of (B) is a bucket of strangers' wills.

## Flow

1. **Gate.** The button is disabled while `blockingProblems(data)` is non-empty,
   with the reasons listed underneath. We do not post drafts. This reuses the
   same validation that already gates PDF generation — there is no second
   opinion about whether a will is finished.
2. **Address.** Ask where to post it, defaulting to the testator's address but
   editable — plenty of people will want it sent somewhere else.
3. **Checkout.** `POST /order` → worker creates a Stripe Checkout Session
   (price fixed server-side; never trust a price from the client) → returns the
   URL → app opens it.
4. **Upload.** On return to the app, `POST /send` with the session id and the
   PDF. The worker calls Stripe to confirm `payment_status === 'paid'` and that
   the session has not already been fulfilled (idempotency key = session id),
   then submits to the print provider.
5. **Confirmations.** Provider webhook "posted" → email the customer. Provider
   webhook "delivered" → email the customer. Luke's stated requirement is that
   both of these exist, which is a real constraint on provider choice (below).

## Provider

Requirements, in the order they actually matter:

1. **Webhooks for "posted" and "delivered"** — Luke's explicit requirement.
2. **UK printing and posting**, so there is no international transfer of
   personal data to argue about.
3. A **REST API**. SOAP is workable but every hour spent on envelope plumbing
   is an hour not spent on the product.
4. **Per-item cost** on a ~6–10 side mono A4 pack, no minimum volume.
5. **Art 28 processor terms** they will actually sign.

**Docmail (CFH)** is the incumbent candidate from the earlier research: mono A4
economy around £1.01 plus ~8p per extra side, so a six-side pack lands near
£1.30–1.45 ex-VAT, and there is already an account (balance ~£4.45 — it needs
topping up before any real order). Two caveats:

- The API is **SOAP**, not REST.
- **Webhooks are unconfirmed.** The earlier note recorded polling-style status
  operations, not push callbacks. If Docmail cannot push "posted" and
  "delivered", it fails Luke's first requirement and we either poll on a
  schedule and email from that, or we use someone else.

**I could not verify the API endpoint from this container today.** Every
commonly-cited path under `cfhdocmail.com` returned 404 (the host is alive and
answering — it is the paths that are wrong or have moved), and the real API
documentation sits behind the Docmail portal login. So rather than write an
integration against remembered endpoint names, the next step is to pull the
current WSDL or API PDF from the account. That is a browser job, not a guess.

Alternatives worth a quote if Docmail has no webhooks: **Stannp** (UK, REST),
**PostGrid** and **Lob** (both REST, check where the printing physically
happens before assuming UK). Decision belongs to Luke because it trades unit
cost against the webhook requirement he set.

## What goes in the pack

Roughly 6–8 sides today: the will itself (2–4), signing instructions (1–2),
"what can change or override this will" (1), and the important notice (1).

Open question for Luke, because it changes the price: **one copy or two?** Two
copies — one to sign, one to keep unsigned as a reference — costs maybe 60–80p
more and removes the "I made a mistake signing it and now I have to buy
another" support case entirely. I would include two, and say so on the sales
page, because it is a visible reason the pack costs more than printing it at
home.

Also worth deciding: plain first class, or signed-for. Signed-for is a few
pounds and turns "it never arrived" from a refund into a tracking number.

## Money

At **£14.99** with a ~£1.50 print cost and Stripe at 1.5% + 20p (~42p), the
margin is roughly £13 per order. Luke is a sole trader and not VAT registered,
so there is no VAT to charge — but that also means supplier VAT is a real cost,
not something to reclaim, so quote supplier prices gross.

**First revenue in any venture triggers the HMRC CWF1 registration reminder.**
This is the venture most likely to trip it first.

## Compliance

Not optional, and mostly writing rather than code:

- **Will writing is not a reserved legal activity** in England and Wales
  (Legal Services Act 2007 s.12 lists the reserved activities; drafting a will
  is not among them). Selling this is lawful without authorisation. **Probate
  activities are reserved**, so the app must never offer to act as executor or
  to apply for a grant.
- **Terms of sale**: we print and post exactly what the customer produced; we
  do not read it, check it, or advise on it.
- **Cancellation**: distance selling gives a 14-day right to cancel under the
  Consumer Contracts (Information, Cancellation and Additional Charges)
  Regulations 2013, but goods "made to the consumer's specifications or clearly
  personalised" are exempt. A printed will is personalised, so the exemption
  should apply — **it only applies if the customer is told before ordering**,
  so that notice has to be on the checkout page, not buried. Refund anyway if
  the pack has not gone to print; it costs nothing and avoids the argument.
- **Privacy notice** covering: what we send to the printer, that we keep no
  copy, and who the printer is (they are a processor, we are the controller).
- **Art 28 processor agreement** with whichever provider is chosen.
- No storage means no data breach to report. That is the main reason to keep
  design (A) even when (B) looks easier.

## Build order

1. Confirm the provider and get its real API documentation.
2. Cloudflare Worker: `/order`, `/send`, `/stripe-webhook`, `/print-webhook`.
3. App: address screen, gated button, paid-but-unsent recovery banner.
4. Test end to end by posting a will to Luke's own address.
5. Terms, privacy and refund pages published before the first real sale.

Steps 2 and 3 are about a day's work once step 1 is done. Step 1 is blocked on
credentials I do not have.

## What Luke has to do

Nothing here can be done from my container.

1. **Decide the provider.** Docmail is cheapest and already has an account, but
   its webhook support is unconfirmed and it is SOAP. If "posted" and
   "delivered" callbacks are a hard requirement, we may be paying more for a
   REST provider that has them. Your call.
2. **Docmail account**: log in, **top up the balance** (about £4.45 left — one
   test order and it is empty), move billing to the Monzo business account, and
   send me the **API documentation / WSDL** from the portal. I cannot reach the
   API endpoints from here.
3. **Stripe**: create the account. Sole trader is fine to start, but if the Ltd
   is coming, note that changing the entity later means re-verification.
   Provide a restricted API key, and add the webhook endpoint once I have
   deployed the worker.
4. **Cloudflare**: a Workers API token so I can deploy. The account already
   exists (Paint Index runs on Pages).
5. **A sending address** for the "your will is in the post" emails, on a domain
   you own.
6. **Decide**: price, one copy or two in the pack, first class or signed-for.
7. **Publish** the terms, refund and privacy pages once I have drafted them —
   they need to be live before the first sale, not after it.
8. **HMRC CWF1** when the first payment lands.

---

## PROVIDER CHOSEN: Intelliprint (verified 9-Sep-2026)

Docmail is superseded. Intelliprint (intelliprint.**net**, not .co.uk) is REST,
pay-as-you-go, and has the webhook we need. API key is live and **verified 200**
against `GET /v1/prints` from this container. Key stored gitignored at
`projects/will-writer/.intelliprint-key` (INTELLIPRINT_API_KEY=...).

**API (all verified from docs + live ping):**
- Base: `https://api.intelliprint.net/v1`
- Auth: `Authorization: Bearer <key>` (raw key also accepted). No separate
  test key — use the `testmode` flag.
- Create letter: `POST /v1/prints`, **multipart/form-data**:
  - `type=letter`
  - `file=@will.pdf` (accepts PDF, Word, RTF, PNG, JPEG) — OR `content=<text>`
  - `recipients[0][address][name|line|postcode|country]`
  - `postage[service]=uk_first_class` (options below)
  - `confirmed` — `false` = draft, **no charge**, editable 30 days; `true` =
    submit for print+post
  - `testmode` — `true` = no charge, hidden from dashboard (dev)
- Postage services: `uk_second_class`, `uk_first_class`,
  `uk_first_class_signed_for`, `uk_second_class_signed_for`, `tracked_24`,
  `tracked_48`, `uk_special_delivery(_9am)`, `international`.
- **No balance/credit endpoint** — top up or use pay-later billing; payment
  failure returns error type/code `payment_error`.

**Webhooks (Svix — signed, retried, replayable):**
- Single event: **`letter.updated`** — status transitions cover
  printed / dispatched / delivered / returned. (Also `mailing_list.addresses_validated`.)
- Registered in the account UI at `https://account.intelliprint.net/api_keys`,
  NOT via API. Svix gives signature verification for the worker.

**✅ DECIDED 9-Sep — "posted is fine" (Luke).** Default postage = `uk_first_class`,
`confirmed:true`; customer gets a **dispatched** confirmation only, no delivered
tracking, no signed/tracked upsell. Original reasoning kept below.

**"delivered" confirmation vs postage class.** Plain
`uk_first_class`/`uk_second_class` are **untracked** (docs: Tracking = No), so a
reliable `delivered` status almost certainly will NOT fire for them — only
`printed`/`dispatched` will. If Luke's "tell the customer it's delivered"
requirement is hard, we must default to a **tracked** service (`tracked_48`
cheapest with tracking, or `_signed_for`) — costs more per item. Otherwise ship
1st class and only promise a "posted/dispatched" confirmation.

**Revised build (unchanged shape, Intelliprint swapped in):**
1. Cloudflare Worker: `/order` (Stripe Checkout), `/stripe-webhook`
   (payment ok → generate PDF → `POST /v1/prints` confirmed:true), `/print-webhook`
   (Svix `letter.updated` → email customer on dispatched/delivered).
2. App: address screen + gated "print & post" button behind the £-order.
3. Zero-storage: PDF generated at send time, not persisted.

**Still needed from Luke:** Stripe restricted key + Cloudflare Workers token;
postage-class decision above; top up Intelliprint or enable pay-later.

## Spend-safety (Luke asked 9-Sep — "billing limit just in case")

Intelliprint's billing help docs are unpublished ("guides on their way"), so I
could not confirm a native hard spend-cap setting. Their category list DOES
name "account credit, invoicing, VAT, subaccount spend controls" — so a cap may
exist; confirm via hello@intelliprint.net. Robust guardrails regardless:

1. **Keep the account on PREPAY (account credit), NOT pay-later/invoicing.** The
   topped-up balance is then the hard ceiling — worst case, runaway code can
   only spend the balance, then `payment_error` and it stops. Real safety net,
   needs no feature from them.
2. **In our Worker:** only ever send `confirmed:true` from inside the
   Stripe-webhook after a *successful* payment → one paid order = one letter.
   Dev uses `testmode:true` (no charge). Add a daily counter in the Worker (KV)
   refusing > N letters/day as a circuit-breaker independent of Intelliprint.
3. Card note: Luke is retiring a Mastercard — confirm which card funds the
   top-up; route to the Monzo business account (deductible business cost).

---

## ✅ BUILT + WORKER DEPLOYED (10-Sep-2026)

Feature is built end-to-end and the Cloudflare Worker is **live** (test mode).

**Worker:** `https://sortedwill-print.nanoluke521.workers.dev` (Cloudflare account
`nanoluke521`, acct id `1a675faf…`). Deployed with the on-file
`nano-workers-kv-2026-07-05` token. KV namespace `ORDERS` =
`a6ef131fd9c0480187a2e43efb43a267`. Secrets set: `STRIPE_SECRET_KEY` (test),
`INTELLIPRINT_API_KEY`. Code = `worker/` (see worker/README.md).

**Verified live against the deployed worker:**
- `GET /health` → `{ok:true, testmode:true}` (testmode inferred from the sk_test_ key).
- `POST /order` → real Stripe Checkout session + hosted URL.
- `POST /send` on an **unpaid** session → `402 not_paid` — the payment gate holds.

**App side (committed on branch `print-and-post`, NOT yet merged/deployed):**
- `src/print.ts` client (default API URL points at the live worker).
- `src/screens/PrintPostModal.tsx` address+email sheet, £14.99, cancellation notice.
- `Review.tsx` "Print & post — £14.99" button wired + gated on `blockingProblems`.
- `App.tsx` paid-return handler regenerates the PDF on-device and streams it once.

**Still to do before a real (live) sale:**
1. Merge `print-and-post` → build/deploy the web app to sortedwill.co.uk.
2. Register the two webhooks and set their signing secrets (only needed for the
   dispatch email + unclaimed-refund sweep — the core pay→print flow works without):
   - Stripe → `…/stripe-webhook`, event `checkout.session.completed` → `STRIPE_WEBHOOK_SECRET`.
   - Intelliprint (Svix) at account.intelliprint.net/api_keys → `…/print-webhook`,
     event `letter.updated` → `INTELLIPRINT_WEBHOOK_SECRET`.
3. (Optional) `RESEND_API_KEY` to actually send the "your will is in the post" email.
4. Go-live: restricted **live** Stripe key + `TEST_MODE=false`; top up Intelliprint
   on the Monzo card; **rotate the Stripe test + Intelliprint keys pasted in chat**;
   publish terms/refund/privacy pages.
5. Full paid smoke test (browser-bot clicks Stripe's test card end to end).

---

## ✅ FULL PAID SMOKE TEST + LEGAL PAGES (10-Sep-2026)

**End-to-end paid flow verified** (Stripe test mode, Intelliprint test mode — no
money, no real post):
- browser-bot completed a real Stripe Checkout with test card 4242…4242 →
  Stripe issued the redirect (session `cs_test_a1nU…`).
- `POST /send` against the **paid** session → `{ok:true, letterId:print_…, testmode:true}`
  — the full chain (payment re-check → PDF → Intelliprint letter) works.
- **Double-print bug found & fixed.** A repeat `/send` (browser refresh) created a
  *second* letter, because the `fulfilled:<session>` flag was written
  fire-and-forget AFTER the print call and never registered with `waitUntil`.
  Fixed: reserve the session in KV (`RESERVED`) BEFORE printing, awaited; release
  on print failure; finalise with the real letterId, awaited. In-flight repeat →
  `409 processing`; completed → same letterId + `reused:true`. **Re-tested live:
  repeat submit returns the same letter, no second print.**
- **GitHub Pages redirect fix.** Site is on GH Pages, which 404s deep paths, so
  `/paid?session_id` never loaded the app. Success/cancel URLs now point at the
  site **root** — the paid-return handler reads `?session_id` off any path.

**Legal pages** (committed, served from `public/` → live at the site root once the
app is redeployed): `/terms.html`, `/refund.html`, `/privacy.html`. Linked from the
payment sheet. Each carries a placeholder for the **trader identity + business
address** — Luke to supply before go-live (UK Consumer Contracts Regs require it).

**Remaining before a real sale (unchanged core): merge+deploy the app, register the
two webhooks, drop in the trader address, live Stripe key + `TEST_MODE=false`, top up
Intelliprint, rotate the pasted keys.**
