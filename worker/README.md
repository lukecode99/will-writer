# sortedwill print-and-post worker

Zero-storage bridge: **Stripe Checkout (money in) → Intelliprint (print + post)**.
The will PDF is generated on the device and only passes through `/send` for the
life of one request — it is streamed to Intelliprint and never stored.

## Endpoints

- `POST /order` — `{ email? }` → creates a Stripe Checkout Session (price fixed
  server-side) → `{ url, sessionId }`. App opens `url`.
- `POST /send` — `multipart/form-data`: `sessionId`, `file` (the PDF), `name`,
  `line`, `postcode`, `country`. Verifies the session is **paid** and unspent
  (idempotency = sessionId), then submits to Intelliprint `confirmed:true`.
  → `{ ok, letterId }`.
- `POST /stripe-webhook` — signature-verified; records paid sessions for the
  unclaimed-refund sweep.
- `POST /print-webhook` — Svix-verified `letter.updated`; on `dispatched` emails
  the customer (if an email provider is configured).
- `GET /health` — `{ ok, testmode }`.

## Spend safety

- Only `/send`, **after** Stripe confirms payment, ever sends `confirmed:true`.
  One paid order = one letter.
- `DAILY_CAP` KV counter refuses more than N confirmed letters/day regardless of
  Intelliprint's own controls.
- Keep the Intelliprint account on **prepay** so the balance is a hard ceiling.
- In dev the worker sends Intelliprint `testmode:true` (no charge) — inferred
  from an `sk_test_` Stripe key, or forced with `TEST_MODE`.

## Deploy (needs a Cloudflare Workers API token)

```bash
cd worker
npm install
npx wrangler kv namespace create ORDERS      # paste the id into wrangler.toml
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put INTELLIPRINT_API_KEY
npx wrangler secret put INTELLIPRINT_WEBHOOK_SECRET
# optional: npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

Then:
1. Point the app at the deployed URL (`EXPO_PUBLIC_PRINT_API` — see app `.env`).
2. Add the Stripe webhook endpoint → `https://<worker>/stripe-webhook`
   (event `checkout.session.completed`), copy its `whsec_` into the secret.
3. Register the Svix webhook at `https://account.intelliprint.net/api_keys`
   → `https://<worker>/print-webhook` (event `letter.updated`), copy its signing
   secret into `INTELLIPRINT_WEBHOOK_SECRET`.

## Local test

```bash
cp .dev.vars.example .dev.vars   # fill in test keys
npm run dev
```

## Go-live checklist

- Swap `STRIPE_SECRET_KEY` for a **restricted live** key (Checkout + webhooks only).
- Set `TEST_MODE=false`.
- Top up / enable Intelliprint billing on the Monzo business card.
- Rotate any key that was pasted in chat.
- Publish terms / refund / privacy pages before the first real sale.
