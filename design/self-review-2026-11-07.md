# SortedWill — self design / UX review (7 Nov 2026)

Grounded in the live screens: Landing, Home (start/saved/printed), Account, and the wizard. Ordered by impact. "Ship" = small, do now; "Next" = worth a card; "Later" = nice-to-have.

## The honest headline
The app's voice is its biggest asset — plain, calm, honest about limits. The design is clean but **text-dense and visually flat**: no imagery, no brand mark, no trust iconography. For something as weighty as a will, a first-time visitor needs *reassurance signals* as much as information. Most wins below are about trust and hierarchy, not restructuring.

## Ship now (small)
1. **Tap targets.** The Account button is ~31px tall (7px padding). iOS/Android guidance is 44px minimum. Bump header button and the small text-link rows (legal row, "Use a different email") to ≥44px hit area.
2. **Secondary-text legibility.** A lot of load-bearing copy sits at 12–12.5px in `textLight` (#6B7280 on #F7F9FC ≈ 4.3:1 — just under AA for small text). Floor important secondary text at 13–14px and darken the greys one step (e.g. #5B6472) so the privacy/price footnotes pass AA comfortably.
3. **Signed-in state in the header.** Right now "Account" looks identical signed-in and signed-out. Show a filled/● variant or the email initial when signed in, so the persisted session is visible at a glance.
4. **Homepage wordmark.** Tapping it currently does nothing on the homepage — make it scroll-to-top instead of a dead tap.

## Next (worth a card)
5. **Trust strip under the hero.** A single row of 3–4 micro-badges: "England & Wales law" · "No sign-up to start" · "Private by design" · "£14.99 printed & posted". Converts the wall of prose into a scannable promise.
6. **An FAQ / "common worries" block.** The questions a will-buyer actually has aren't answered on the page: *Is a home-made will legally valid? Who can be a witness? What if I move house or remarry? What happens to my data?* We already answer most of these inside the flow — surface them on the homepage. Directly addresses the trust gap.
7. **Show the product.** A single blurred/sample thumbnail of a finished will PDF ("this is what you get") does more for credibility than three paragraphs. We generate the PDF already — a static sample image is cheap.
8. **Tappable progress steps.** The wizard progress bar is display-only. Let a user tap a *completed* step to jump back (Review already deep-links by name, so the plumbing exists). Reduces the "am I trapped in a flow" feeling.
9. **Payment reassurance at the pay step.** "Secure payment via Stripe", the refund line, and "we keep no copy of your will" belong *right next to the pay button*, not only in the footer. This is the highest-anxiety moment.

## Later (polish)
10. **A light brand mark.** Even a simple quill/tick glyph beside the wordmark lifts it from "unstyled app" to "a brand I'd trust with this".
11. **Estimated time + section preview** on the homepage ("about 10 minutes, 7 short sections").
12. **Empty-state warmth** on Home when there are no wills yet — one friendly line rather than straight into two buttons.
13. **Consistent CTA voice.** "Start my will" (landing) vs "A will for me" / "A will for someone else" (home) is fine, but a one-word visual cue (icon) would tie them together.

## What's already good (keep)
- The "It isn't right for everyone" honesty block — rare and trust-building; don't bury it.
- Free-to-write / pay-to-print pricing is a strong hook — it's doing a lot of work.
- Autosave + the persist-failure warning is genuinely considerate engineering.
- The privacy promise ("answers stay on your device, nothing kept once printed") is the differentiator — it should be louder, not quieter.

## iOS account screen — design notes (see Trello WILL-ACCOUNT-IOS)
SortedWill is already Expo/React Native, so `Account.tsx` renders natively — these are the iOS-specific decisions, not a new screen:
- **Sign-in:** the web `/?login=<token>` URL param doesn't exist in a native app. Two options: (a) **6-digit email OTP code** entered in the app — no deep-link plumbing, most robust, recommend for v1; (b) **Universal Link** (associated-domains + apple-app-site-association) so the emailed link opens the app. Spec both; ship (a).
- **Session storage:** hold the session token in the **iOS Keychain**, not AsyncStorage.
- **Will storage / backup posture:** wills already live on-device. On iOS that means they'd ride iCloud/iTunes backups by default — which quietly breaks "your answers never leave this device". **Exclude the will store from iCloud backup** (set `NSURLIsExcludedFromBackupKey` / store outside Documents), or make cloud backup an explicit opt-in. Document whichever we pick.
- **Parity:** account still syncs *only* the printed-order record; same privacy explainer copy.
- **Native feel:** large-title nav, system back gesture, Dynamic Type; consider Sign in with Apple later (optional, not v1).

Designer to produce the buildable spec against the live /api contract; Nano scopes the Keychain / OTP / backup-exclusion implementation.
