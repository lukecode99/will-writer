/**
 * sortedwill print-and-post worker
 * ---------------------------------
 * Zero-storage, pay-first-then-upload. The will PDF is generated on the device
 * and only ever passes through this worker for the duration of one /send
 * request — it is streamed straight to Intelliprint and never written down.
 *
 * Endpoints:
 *   POST /order          -> create a Stripe Checkout Session (price fixed here,
 *                           never trusted from the client). Returns {url,sessionId}.
 *   POST /send           -> multipart: {sessionId, file=<pdf>, name,line,postcode,country}.
 *                           Verifies the session is PAID (via Stripe) and not
 *                           already fulfilled (idempotency), then submits the PDF
 *                           to Intelliprint confirmed:true. Returns {ok,letterId}.
 *   POST /stripe-webhook -> verifies signature; auto-refunds a session that was
 *                           paid but never claimed within the grace window.
 *   POST /print-webhook  -> verifies the Svix signature on Intelliprint's
 *                           `letter.updated`; on `dispatched` emails the customer.
 *
 * Nothing about the will itself is persisted. The only things stored in KV are:
 *   fulfilled:<sessionId> = letterId           (idempotency flag, TTL 90d)
 *   letter:<letterId>     = {email, dispatchedNotified}  (email only, TTL 30d)
 *   count:<yyyy-mm-dd>    = n                   (daily circuit-breaker)
 * — an email address and a couple of ids, never a name/address/beneficiary.
 */

const IP_BASE = 'https://api.intelliprint.net/v1';

// Sentinel stored at fulfilled:<session> while a /send is mid-print, so a
// concurrent or repeat request cannot start a second letter for the same order.
const RESERVED = 'RESERVED';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/order' && request.method === 'POST') {
        return withCors(await handleOrder(request, env), cors);
      }
      if (url.pathname === '/verify' && request.method === 'POST') {
        return withCors(await handleVerify(request, env), cors);
      }
      if (url.pathname === '/send' && request.method === 'POST') {
        return withCors(await handleSend(request, env, ctx), cors);
      }
      if (url.pathname === '/auth/request' && request.method === 'POST') {
        return withCors(await handleAuthRequest(request, env, ctx), cors);
      }
      if (url.pathname === '/auth/verify' && request.method === 'POST') {
        return withCors(await handleAuthVerify(request, env), cors);
      }
      if (url.pathname === '/auth/otp/request' && request.method === 'POST') {
        return withCors(await handleOtpRequest(request, env, ctx), cors);
      }
      if (url.pathname === '/auth/otp/verify' && request.method === 'POST') {
        return withCors(await handleOtpVerify(request, env), cors);
      }
      if (url.pathname === '/account/orders' && request.method === 'GET') {
        return withCors(await handleAccountOrders(request, env), cors);
      }
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        return withCors(await handleAuthLogout(request, env), cors);
      }
      if (url.pathname === '/stripe-webhook' && request.method === 'POST') {
        return await handleStripeWebhook(request, env);
      }
      if (url.pathname === '/print-webhook' && request.method === 'POST') {
        return await handlePrintWebhook(request, env);
      }
      if (url.pathname === '/health') {
        return json({ ok: true, testmode: isTestMode(env) }, 200);
      }
      return withCors(json({ error: 'not_found' }, 404), cors);
    } catch (err) {
      // Never leak internals to the client; the will flow must fail closed.
      console.error('worker error', err && err.stack ? err.stack : String(err));
      return withCors(json({ error: 'server_error' }, 500), cors);
    }
  },
};

/* ------------------------------------------------------------------ /order */

async function handleOrder(request, env) {
  const body = await request.json().catch(() => ({}));
  // Two products, both priced server-side. A client-supplied amount is ignored.
  //   print    (£14.99) -> pack is printed and posted via Intelliprint (/send)
  //   download (£10.00) -> PDF is generated & downloaded on-device (/verify)
  const product = body.product === 'download' ? 'download' : 'print';
  const amount = product === 'download' ? downloadPence(env) : pricePence(env);

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  // Redirect back to the site ROOT with the session id in the query. The app
  // reads ?session_id off any path, and root is the one URL guaranteed to exist
  // on a static SPA host (GitHub Pages 404s deep paths like /paid).
  params.set('success_url', `${appOrigin(env)}/?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${appOrigin(env)}/`);
  params.set('line_items[0][price_data][currency]', 'gbp');
  params.set(
    'line_items[0][price_data][product_data][name]',
    product === 'download' ? 'Will PDF download' : 'Printed & posted will pack',
  );
  params.set('line_items[0][price_data][unit_amount]', String(amount));
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[app]', 'sortedwill');
  params.set('metadata[product]', product);
  params.set('payment_intent_data[metadata][app]', 'sortedwill');
  // We need the customer's email for the dispatch confirmation. Checkout
  // collects it; we read it back off the session at /send time.
  if (body.email && looksLikeEmail(body.email)) {
    params.set('customer_email', body.email);
  }
  // Consumer-Contracts notice: personalised / digital content loses the 14-day
  // cancel right once fulfilled, and the notice must be shown before ordering.
  params.set(
    'custom_text[submit][message]',
    product === 'download'
      ? 'This is a personalised digital download. By continuing you agree it is prepared and made available to you immediately, so the 14-day cancellation right does not apply once the file is downloaded.'
      : 'Your will is printed to your exact specification, so the 14-day cancellation right does not apply once it goes to print. We refund in full if it has not yet printed.',
  );

  const session = await stripe(env, 'POST', '/v1/checkout/sessions', params);
  return json({ url: session.url, sessionId: session.id }, 200);
}

/* ----------------------------------------------------------------- /verify */

// Download orders never upload the PDF — it is generated and saved on-device.
// This just confirms, server-side, that the session was paid at the DOWNLOAD
// price, so the app only unlocks the download after real money moved. Read-only
// and idempotent: it stores nothing and can be called on every return/reload.
async function handleVerify(request, env) {
  const body = await request.json().catch(() => ({}));
  const sessionId = body.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    return json({ error: 'missing_session' }, 400);
  }
  // A bogus, expired, or wrong-mode session id makes Stripe 404, which the
  // stripe() helper turns into a throw. Treat any lookup failure as "not paid"
  // rather than a 500 — this endpoint is safe to hit on any /paid reload.
  let session;
  try {
    session = await stripe(env, 'GET', `/v1/checkout/sessions/${sessionId}`);
  } catch (err) {
    return json({ error: 'not_paid' }, 402);
  }
  if (!session || session.payment_status !== 'paid') {
    return json({ error: 'not_paid' }, 402);
  }
  // Bind the session to the download price: a £10 session can never be spent as
  // a £14.99 print, and vice-versa (see /send's own amount check).
  if (session.amount_total !== downloadPence(env) || session.currency !== 'gbp') {
    return json({ error: 'amount_mismatch' }, 402);
  }
  return json({ ok: true, testmode: isTestMode(env) }, 200);
}

/* ------------------------------------------------------------------- /send */

async function handleSend(request, env, ctx) {
  const form = await request.formData();
  const sessionId = form.get('sessionId');
  const file = form.get('file');
  const name = str(form.get('name'));
  const line = str(form.get('line'));
  const postcode = str(form.get('postcode'));
  const country = str(form.get('country')) || 'GB';

  if (!sessionId || typeof sessionId !== 'string') {
    return json({ error: 'missing_session' }, 400);
  }
  if (!(file instanceof File)) {
    return json({ error: 'missing_file' }, 400);
  }
  if (!name || !line || !postcode) {
    return json({ error: 'incomplete_address' }, 400);
  }

  // 1) Idempotency: one letter per paid session, ever. `fulfilled:<session>`
  //    holds either the letterId (done) or the sentinel RESERVED (a submit is
  //    in flight). A browser refresh or a double-tap must never print twice.
  const fkey = `fulfilled:${sessionId}`;
  const already = await env.ORDERS.get(fkey);
  if (already && already !== RESERVED) {
    return json({ ok: true, letterId: already, reused: true }, 200);
  }
  if (already === RESERVED) {
    // A concurrent request already owns this session and is mid-print. Tell the
    // client to retry shortly; it will then get the letterId from the branch above.
    return json({ error: 'processing' }, 409);
  }

  // 2) Payment gate — trust Stripe, not the client.
  const session = await stripe(env, 'GET', `/v1/checkout/sessions/${sessionId}`);
  if (!session || session.payment_status !== 'paid') {
    return json({ error: 'not_paid' }, 402);
  }
  if (session.amount_total !== pricePence(env) || session.currency !== 'gbp') {
    // A session whose amount does not match our price is not one we created.
    return json({ error: 'amount_mismatch' }, 402);
  }

  // 2b) Reserve the session BEFORE the slow Intelliprint call, and AWAIT the
  //     write so a subsequent request sees it. This closes the double-print
  //     window that a fire-and-forget post-print write left open. (KV is only
  //     eventually consistent across regions, so this narrows — not eliminates
  //     — a truly simultaneous multi-colo race; a Durable Object lock would be
  //     the fully-atomic upgrade if that ever proves necessary.)
  await env.ORDERS.put(fkey, RESERVED, { expirationTtl: 60 * 60 * 24 * 90 });

  // 3) Circuit-breaker independent of Intelliprint's own controls.
  const day = utcDay();
  const countKey = `count:${day}`;
  const count = parseInt((await env.ORDERS.get(countKey)) || '0', 10);
  if (count >= dailyCap(env)) {
    console.error('daily cap hit', day, count);
    return json({ error: 'daily_cap' }, 429);
  }

  // 4) Submit to Intelliprint. testmode in dev = no charge, hidden.
  const ip = new FormData();
  ip.append('type', 'letter');
  ip.append('file', file, filenameOf(file));
  ip.append('recipients[0][address][name]', name);
  ip.append('recipients[0][address][line]', line);
  ip.append('recipients[0][address][postcode]', postcode);
  ip.append('recipients[0][address][country]', country);
  ip.append('postage[service]', env.POSTAGE_SERVICE || 'uk_first_class');
  ip.append('confirmed', 'true');
  ip.append('testmode', isTestMode(env) ? 'true' : 'false');

  const ipRes = await fetch(`${IP_BASE}/prints`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.INTELLIPRINT_API_KEY}` },
    body: ip,
  });
  const ipJson = await ipRes.json().catch(() => ({}));
  if (!ipRes.ok || !ipJson.id) {
    console.error('intelliprint submit failed', ipRes.status, JSON.stringify(ipJson).slice(0, 500));
    // Payment succeeded but printing did not. Release the reservation so the
    // app can safely retry /send; we never leave a paid order un-printable.
    await env.ORDERS.delete(fkey).catch(() => {});
    return json({ error: 'print_failed', code: (ipJson.error && ipJson.error.code) || null }, 502);
  }

  const letterId = ipJson.id;

  // 5) Finalise the idempotency flag with the real letterId — AWAITED, so a
  //    later retry reads the letter, not the RESERVED sentinel or an empty key.
  await env.ORDERS.put(fkey, letterId, { expirationTtl: 60 * 60 * 24 * 90 });

  // The rest is best-effort and must not fail the order (the letter is already
  // committed at Intelliprint): daily counter + the email for the dispatch note,
  // which comes off the Stripe session, never the will.
  const email =
    (session.customer_details && session.customer_details.email) || session.customer_email || null;
  ctxWaitUntil(ctx, [
    env.ORDERS.put(countKey, String(count + 1), { expirationTtl: 60 * 60 * 48 }),
    email
      ? env.ORDERS.put(`letter:${letterId}`, JSON.stringify({ email }), {
          expirationTtl: 60 * 60 * 24 * 30,
        })
      : Promise.resolve(),
    // Tie the order to the customer's account (keyed by their email) so it
    // syncs to any device they log in on. Record only id/date/product — never
    // the will, the name, or the address.
    email
      ? recordAccountOrder(env, email, { letterId, printedAt: Date.now(), product: 'print' })
      : Promise.resolve(),
  ]);

  return json({ ok: true, letterId, testmode: isTestMode(env) }, 200);
}

/* --------------------------------------------------------- /stripe-webhook */

async function handleStripeWebhook(request, env) {
  const sig = request.headers.get('stripe-signature');
  const payload = await request.text();
  const event = await verifyStripe(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!event) return json({ error: 'bad_signature' }, 400);

  // We do not fulfil from here (the PDF only exists on-device). This exists so
  // a session that is paid but never claimed can be auto-refunded later by a
  // scheduled sweep; for now just acknowledge so Stripe stops retrying.
  if (event.type === 'checkout.session.completed') {
    const s = event.data && event.data.object;
    if (s && s.id) {
      // 7-day claim window; a cron trigger (see wrangler.toml) sweeps these.
      await env.ORDERS.put(`paid:${s.id}`, String(nowSec()), { expirationTtl: 60 * 60 * 24 * 14 });
    }
  }
  return json({ received: true }, 200);
}

/* ---------------------------------------------------------- /print-webhook */

async function handlePrintWebhook(request, env) {
  const payload = await request.text();
  const ok = await verifySvix(payload, request.headers, env.INTELLIPRINT_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'bad_signature' }, 400);

  const event = safeParse(payload);
  const letter = (event && (event.data || event)) || {};
  const letterId = letter.id;
  const status = letter.status || (letter.data && letter.data.status);

  // Intelliprint emits a single `letter.updated`; we only act on dispatched.
  if (letterId && String(status).toLowerCase() === 'dispatched') {
    const raw = await env.ORDERS.get(`letter:${letterId}`);
    const rec = safeParse(raw) || {};
    if (rec.email && !rec.dispatchedNotified) {
      await sendDispatchEmail(env, rec.email);
      rec.dispatchedNotified = true;
      await env.ORDERS.put(`letter:${letterId}`, JSON.stringify(rec), {
        expirationTtl: 60 * 60 * 24 * 30,
      });
    }
  }
  return json({ received: true }, 200);
}

async function sendDispatchEmail(env, to) {
  const from = env.FROM_EMAIL || 'hello@sortedwill.co.uk';
  const subject = 'Your will is in the post';
  const text =
    'Your printed will pack has been dispatched by first-class post and should ' +
    'arrive within a few working days.\n\n' +
    'When it arrives, sign it in front of two adult witnesses who are not ' +
    'beneficiaries (and who are not married to a beneficiary). They must watch ' +
    'you sign, then sign themselves, all in the same room at the same time.\n\n' +
    'sortedwill.co.uk';

  // Email provider is pluggable. Resend if a key is present, else log-only so a
  // missing provider never blocks the print flow.
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: `sortedwill <${from}>`, to, subject, text }),
    });
    if (!res.ok) console.error('resend failed', res.status, (await res.text()).slice(0, 300));
    return;
  }
  console.log('dispatch email (no provider configured):', to);
}

/* -------------------------------------------------------------- accounts */

// Magic-link login. We email a one-time token; clicking the link returns it to
// the app, which exchanges it for a session. No password is ever stored.
//
// The account is keyed only by email, and the ONLY thing it syncs across a
// user's devices is the record of printed orders (letterId + date + product).
// Never the will's contents, never a name or a postal address — so the
// "we keep no copy of your will" promise holds for logged-in users too.

const AUTH_TOKEN_TTL = 60 * 15; // 15 minutes to click the login link
const SESSION_TTL = 60 * 60 * 24 * 90; // 90-day device session
const AUTH_RATE_TTL = 60 * 60; // rate-limit window
const AUTH_RATE_MAX = 5; // login links per email per hour

// On iOS there is no browser to catch a magic link, so the same login is done
// with a 6-digit code typed back into the app. The security properties are the
// identical ones used by the link: single-use, short-lived, rate-limited, and
// it mints the very same `session:` token — so an account is one account whether
// you signed in by link (web) or by code (app).
const OTP_TTL = 60 * 10; // 10 minutes to type the code
const OTP_RATE_TTL = 60 * 10; // request rate-limit window
const OTP_RATE_MAX = 5; // codes per email per 10 minutes
const OTP_MAX_ATTEMPTS = 5; // wrong-code guesses before the code is burned

async function handleAuthRequest(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const email = str(body.email).toLowerCase();
  // Answer identically whether or not we sent anything: no account enumeration,
  // and a malformed address simply never gets an email.
  const ok = json({ ok: true }, 200);
  if (!looksLikeEmail(email)) return ok;

  // Abuse guard: cap login-link requests per email per hour.
  const rlKey = `authrl:${await sha256Hex(email)}`;
  const sent = parseInt((await env.ORDERS.get(rlKey)) || '0', 10);
  if (sent >= AUTH_RATE_MAX) return ok;

  const token = randomToken();
  await env.ORDERS.put(`authtok:${token}`, email, { expirationTtl: AUTH_TOKEN_TTL });
  await env.ORDERS.put(rlKey, String(sent + 1), { expirationTtl: AUTH_RATE_TTL });

  const link = `${appOrigin(env)}/?login=${token}`;
  ctxWaitUntil(ctx, [sendLoginEmail(env, email, link)]);
  return ok;
}

async function handleAuthVerify(request, env) {
  const body = await request.json().catch(() => ({}));
  const token = str(body.token);
  if (!token) return json({ error: 'invalid' }, 400);
  const tkey = `authtok:${token}`;
  const email = await env.ORDERS.get(tkey);
  if (!email) return json({ error: 'invalid' }, 400);
  // One-time: burn the login token so the link cannot be replayed.
  await env.ORDERS.delete(tkey);

  const sessionToken = randomToken();
  await env.ORDERS.put(`session:${sessionToken}`, email, { expirationTtl: SESSION_TTL });
  return json({ ok: true, sessionToken, email }, 200);
}

// iOS sign-in, step 1: email a 6-digit code. Mirrors handleAuthRequest exactly
// — identical response whether or not an account exists (no enumeration), same
// per-email rate cap. We store only a HASH of the code (never the plaintext),
// keyed by a hash of the email, with an attempt counter folded in so a few wrong
// guesses burn it.
async function handleOtpRequest(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const email = str(body.email).toLowerCase();
  const ok = json({ ok: true }, 200);
  if (!looksLikeEmail(email)) return ok;

  const emailHash = await sha256Hex(email);
  const rlKey = `otprl:${emailHash}`;
  const sent = parseInt((await env.ORDERS.get(rlKey)) || '0', 10);
  if (sent >= OTP_RATE_MAX) return ok;

  const code = sixDigitCode();
  const record = JSON.stringify({ hash: await sha256Hex(`${email}:${code}`), attempts: 0 });
  await env.ORDERS.put(`otp:${emailHash}`, record, { expirationTtl: OTP_TTL });
  await env.ORDERS.put(rlKey, String(sent + 1), { expirationTtl: OTP_RATE_TTL });

  ctxWaitUntil(ctx, [sendOtpEmail(env, email, code)]);
  return ok;
}

// iOS sign-in, step 2: exchange {email, code} for a session. Validates the code
// against the stored hash, counts wrong guesses, and on success burns the code
// (one-time) and mints the same `session:` token the magic link would.
async function handleOtpVerify(request, env) {
  const body = await request.json().catch(() => ({}));
  const email = str(body.email).toLowerCase();
  const code = str(body.code).replace(/\D/g, '');
  if (!looksLikeEmail(email) || code.length !== 6) return json({ error: 'invalid' }, 400);

  const emailHash = await sha256Hex(email);
  const okey = `otp:${emailHash}`;
  const rec = safeParse(await env.ORDERS.get(okey));
  if (!rec || typeof rec.hash !== 'string') return json({ error: 'invalid' }, 400);

  if ((rec.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    await env.ORDERS.delete(okey);
    return json({ error: 'too_many_attempts' }, 429);
  }

  const given = await sha256Hex(`${email}:${code}`);
  if (!timingSafeEqual(given, rec.hash)) {
    // Preserve the code's original TTL on the re-put so a wrong guess cannot
    // extend its life; a fresh short window is enough to finish the attempts.
    rec.attempts = (rec.attempts || 0) + 1;
    await env.ORDERS.put(okey, JSON.stringify(rec), { expirationTtl: OTP_TTL });
    return json({ error: 'wrong_code' }, 400);
  }

  // Correct — burn it so the code cannot be replayed, then mint the session.
  await env.ORDERS.delete(okey);
  const sessionToken = randomToken();
  await env.ORDERS.put(`session:${sessionToken}`, email, { expirationTtl: SESSION_TTL });
  return json({ ok: true, sessionToken, email }, 200);
}

async function handleAccountOrders(request, env) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const raw = await env.ORDERS.get(`orders:${await sha256Hex(email)}`);
  const orders = safeParse(raw) || [];
  return json({ ok: true, email, orders }, 200);
}

async function handleAuthLogout(request, env) {
  const token = bearer(request);
  if (token) await env.ORDERS.delete(`session:${token}`).catch(() => {});
  return json({ ok: true }, 200);
}

async function sessionEmail(request, env) {
  const token = bearer(request);
  if (!token) return null;
  return (await env.ORDERS.get(`session:${token}`)) || null;
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Append a printed order to the account record for `email`, keyed by a hash of
// the address so the raw email is never itself a KV key. Stores only what the
// "Your printed wills" screen shows — id, timestamp, product — and dedupes on
// letterId, so a retry or a resync never doubles an entry.
async function recordAccountOrder(env, email, entry) {
  if (!email || !looksLikeEmail(email)) return;
  const key = `orders:${await sha256Hex(email.toLowerCase())}`;
  const list = safeParse(await env.ORDERS.get(key)) || [];
  if (list.some(o => o.letterId === entry.letterId)) return;
  list.push(entry);
  // No expiry: the printed-order history is the whole point of the account.
  await env.ORDERS.put(key, JSON.stringify(list));
}

async function sendLoginEmail(env, to, link) {
  const from = env.FROM_EMAIL || 'hello@sortedwill.co.uk';
  const subject = 'Your SortedWill login link';
  const text =
    'Tap the link below to sign in to SortedWill. It works once and expires in 15 minutes.\n\n' +
    link +
    '\n\nIf you did not ask to sign in, you can ignore this email — nothing will happen.\n\n' +
    'sortedwill.co.uk';
  const html =
    '<p>Tap the button below to sign in to SortedWill. It works once and expires in 15 minutes.</p>' +
    `<p><a href="${link}" style="display:inline-block;background:#1f4e79;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Sign in to SortedWill</a></p>` +
    `<p>Or paste this link into your browser:<br><a href="${link}">${link}</a></p>` +
    '<p style="color:#667">If you did not ask to sign in, you can ignore this email — nothing will happen.</p>';

  if (!env.RESEND_API_KEY) {
    console.log('login email (no provider configured):', to, link);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: `SortedWill <${from}>`, to, subject, text, html }),
  });
  if (!res.ok) console.error('resend login failed', res.status, (await res.text()).slice(0, 300));
}

async function sendOtpEmail(env, to, code) {
  const from = env.FROM_EMAIL || 'hello@sortedwill.co.uk';
  const subject = `${code} is your SortedWill code`;
  const text =
    `Your SortedWill sign-in code is ${code}\n\n` +
    'Type it into the app to sign in. It works once and expires in 10 minutes.\n\n' +
    'If you did not ask to sign in, you can ignore this email — nothing will happen.\n\n' +
    'sortedwill.co.uk';
  const html =
    '<p>Your SortedWill sign-in code is:</p>' +
    `<p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#1f4e79;margin:8px 0">${code}</p>` +
    '<p>Type it into the app to sign in. It works once and expires in 10 minutes.</p>' +
    '<p style="color:#667">If you did not ask to sign in, you can ignore this email — nothing will happen.</p>';

  if (!env.RESEND_API_KEY) {
    console.log('otp email (no provider configured):', to, code);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: `SortedWill <${from}>`, to, subject, text, html }),
  });
  if (!res.ok) console.error('resend otp failed', res.status, (await res.text()).slice(0, 300));
}

// A uniformly-distributed 6-digit code (000000–999999). Rejection-samples the
// top of the 32-bit range so low codes are not very slightly more likely.
function sixDigitCode() {
  const max = 4294967296 - (4294967296 % 1000000); // largest clean multiple
  const buf = new Uint32Array(1);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= max);
  return String(n % 1000000).padStart(6, '0');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------ Stripe helper */

async function stripe(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? params.toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('stripe error', res.status, JSON.stringify(data).slice(0, 400));
    throw new Error(`stripe ${res.status}`);
  }
  return data;
}

/* ------------------------------------------------------- signature helpers */

// Stripe: t=<ts>,v1=<hmac_sha256_hex(ts.payload, secret)>
async function verifyStripe(payload, header, secret) {
  if (!header || !secret) return null;
  const parts = Object.fromEntries(
    header.split(',').map(kv => kv.split('=').map(s => s.trim())),
  );
  const ts = parts.t;
  const given = parts.v1;
  if (!ts || !given) return null;
  const expected = await hmacHex(secret, `${ts}.${payload}`);
  if (!timingSafeEqual(expected, given)) return null;
  // Reject anything older than 5 minutes (replay guard).
  if (Math.abs(nowSec() - parseInt(ts, 10)) > 300) return null;
  return safeParse(payload);
}

// Svix (Intelliprint): signature over `${id}.${timestamp}.${payload}`,
// HMAC-SHA256 with the base64 secret (after the `whsec_` prefix), b64 output.
async function verifySvix(payload, headers, secret) {
  if (!secret) return false;
  const id = headers.get('svix-id') || headers.get('webhook-id');
  const ts = headers.get('svix-timestamp') || headers.get('webhook-timestamp');
  const sigHeader = headers.get('svix-signature') || headers.get('webhook-signature');
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(nowSec() - parseInt(ts, 10)) > 300) return false;

  const key = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const expected = await hmacB64(base64ToBytes(key), `${id}.${ts}.${payload}`);
  // Header is space-separated `v1,<sig>` pairs; any match passes.
  for (const token of sigHeader.split(' ')) {
    const sig = token.includes(',') ? token.split(',')[1] : token;
    if (sig && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacB64(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(buf));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* --------------------------------------------------------------- utilities */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function withCors(res, cors) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
function corsHeaders(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.APP_ORIGIN || 'https://sortedwill.co.uk')
    .split(',')
    .map(s => s.trim());
  const allow = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function appOrigin(env) {
  return (env.APP_ORIGIN || 'https://sortedwill.co.uk').split(',')[0].trim();
}
function pricePence(env) {
  const n = parseInt(env.PRICE_PENCE || '1499', 10);
  return Number.isFinite(n) && n > 0 ? n : 1499;
}
function downloadPence(env) {
  const n = parseInt(env.DOWNLOAD_PENCE || '1000', 10);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}
function dailyCap(env) {
  const n = parseInt(env.DAILY_CAP || '50', 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}
function isTestMode(env) {
  // Explicit override wins; otherwise infer from the Stripe key.
  if (env.TEST_MODE === 'true') return true;
  if (env.TEST_MODE === 'false') return false;
  return (env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
}
function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function filenameOf(file) {
  const n = (file && file.name) || 'will.pdf';
  return n.toLowerCase().endsWith('.pdf') ? n : `${n}.pdf`;
}
function looksLikeEmail(s) { return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function nowSec() { return Math.floor(Date.now() / 1000); }
function utcDay() { return new Date().toISOString().slice(0, 10); }
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function base64ToBytes(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
// Register best-effort work so it completes after the response is returned.
// Falls back to a fire-and-forget Promise.all if no execution context is given.
function ctxWaitUntil(ctx, promises) {
  const work = Promise.all(promises).catch(err => console.error('kv write failed', err));
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  return work;
}
