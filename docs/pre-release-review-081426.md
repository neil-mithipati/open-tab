# Open Tab Release Review

A pre-release assessment across four questions – is it good, is it useful, is it feasible, is it viable – based on a full code audit and a live end-to-end walkthrough: real receipt scan, split, share, and crowd-claim on a phone-sized viewport.

---

## Verdict

**Ship it – after a one-to-two-day hardening pass. The product is genuinely good; the infrastructure has a short list of fixable holes that shouldn't meet the public.**

- 🟢 **Good** – polished, real design system
- 🟢 **Useful** – solves the payer's problem
- 🟡 **Feasible** – after the must-fix list
- 🟢 **Viable** – costs are a low bar

---

## Screens

| Screenshot | Caption |
| --- | --- |
| Landing | Landing: three-beat pitch, one-tap guest start. |
| Even split / charges | Even split – note both friends charged $58.36 while the payer's own share is missing (guest bug, must-fix #6). |
| Friend claim page | Friend's no-login claim page with live estimate and honest disclaimer. |
| Owner collect view | Owner's view while friends claim: who's done, what's unclaimed. |

---

## Dimension 1 — Good: is it designed well and usable?

**Yes. This looks and feels like a product, not a project. The gaps are in feedback and failure states, not in the design language.**

The "liquid glass" identity is coherent everywhere – one token layer in `globals.css`, a real component kit (`GlassButton`/`Card`/`Input`), DM Sans, gradient avatars, and mobile-first details most side projects skip: 16px inputs to kill iOS zoom, `min-h-dvh`, safe-area handling in the bottom nav, decimal keyboards on money fields. The scanning skeleton, the parsed/original photo toggle, staged modals where Cancel is a true no-op, and optimistic claim toggles are all signs of taste.

### What holds it back

- **The two most important buttons can fail silently.** Share (`src/app/receipts/new/page.tsx:26–35`) and Done swallow errors – a failed share does nothing visible, and a successful one copies a link to the clipboard without ever saying "copied."
- **No confirmation on anything destructive.** "Delete receipt," "Reopen editing" (which deletes all charges), friend and group removal – all one tap, no undo, no toast system anywhere.
- **`pt-safe` is used in five headers but defined nowhere** – with `viewportFit: cover`, the close button sits under the iPhone notch. One `@utility` in `globals.css` fixes it.
- **Small targets:** 36px header buttons, 24px remove-X's – under the 44px guideline on the exact screens people use one-handed at dinner.
- **Live-update promise isn't kept:** the README says owners "watch claims arrive live," but both claim views are manual-refresh only.
- Accessibility: no focus traps or Escape in modals, click-only tooltips, Enter-only key handlers, no `aria-live` for async errors. Fine for launch; worth a pass soon.

---

## Dimension 2 — Useful: does it help the person who picked up the tab?

**Yes – for a US friend group where everyone has Venmo, this genuinely kills the pain. The cliff edges are what happens when reality deviates from that script.**

The core loop worked start-to-finish in my live test: photo → Gemini parsed a 5-item receipt perfectly into an editable check → even split or tap-to-itemize → per-person Venmo charge links with itemized notes → a share link friends open without any login to claim their own items. That last part – the crowd-claim flow – is the differentiator; it removes the "everyone install an app" tax that makes Splitwise-style tools die at the table. The proportional tax/tip math checks out, and the owner-side collect view correctly reconciles to the total.

### Where it abandons the payer

- **A failed scan is a dead end.** On parse failure the user lands on an empty check with no error, no retry, and no way to type items in – items can only ever come from Gemini, and names can't be edited (`CaptureStep.tsx:71–76`). One bad photo = unusable tab. There's also no path for a tab with no receipt at all.
- **Guest even-splits overcharge friends.** Confirmed live: a guest payer isn't included as a participant, so the whole $116.71 was split across the two friends ($58.36 each) with the payer paying nothing – silently wrong money math on the likeliest first-run path.
- **No Venmo, no entry.** Participants must have a Venmo username to claim; there's no "pay in cash" or free-text-name path, and no way for the owner to record an offline payment. Also caps the audience to the US by construction.
- **The OCR is trusted, never checked.** I fed it a receipt whose stated total didn't match its items; the app displayed Subtotal $86.00 above Total $116.71 without flagging the $5 gap – and the owner silently absorbs the difference at collect time.
- No reminders/notifications beyond the manual "Remind" link, no "you're owed $X" rollup on the dashboard, and abandoned scans pile up as permanent orphan "open" tabs (three identical ones appeared during my testing).

---

## Dimension 3 — Feasible: can the current infra take a small wave?

**Cost-wise, easily. Robustness-wise, not yet – the must-fix list below is the gap, and none of it is more than a day or two of work.**

At a few hundred real users the bill is single-digit dollars: Gemini 2.5 Flash costs roughly $2 per 1,000 scans, and Supabase/Vercel free tiers carry the rest. The binding constraint isn't money – it's **Supabase's 1 GB storage against uncompressed 3–8 MB phone photos (~150–300 receipts)**, then Vercel image transformations, then function timeouts on slow Gemini calls (no `maxDuration` is set; Hobby defaults will 504).

### Must fix before the link goes public

1. **Set `NEXT_PUBLIC_APP_URL` in Vercel – and make the code fail loudly without it.** The fallback is `http://localhost:3000` (`src/lib/qr/inviteUrl.ts`), so if it's unset, every share link and QR code silently points at localhost. The most likely total-feature failure on day one.
2. **Close the SSRF hole in the parse route.** `/api/receipts/parse` fetches a client-supplied `signedUrl` (`route.ts:28`) – any logged-in user (including one-click guests) can make your server fetch arbitrary internal URLs and echo results. Derive the URL server-side from `receiptId`; `getReceiptImageUrl` in `src/lib/queries.ts:137` already does exactly this. Stop returning raw error internals (`detail: String(err)`) too.
3. **Stop publishing every user's email.** `profiles_select_all using (true)` (`0008_rls_policies.sql:4–5`) lets anyone with the browser key read all emails, Venmo usernames, and invite tokens. Replace with a column-restricted lookup (view or RPC); add a caller check to the `add_friendship` RPC while you're in there (today anyone can force a friendship between two arbitrary users).
4. **Compress photos client-side** (canvas re-encode to ~1600px JPEG) before upload. Turns the storage ceiling from ~200 receipts into ~5,000, makes parses faster, and shrinks function memory. Also cap size/MIME server-side.
5. **Fix the browser-side save path.** Done/Share both do delete-everything-then-reinsert from the client across multiple round-trips (`receipts/new/page.tsx:84–167`, `receiptShare.ts:50–83`) – a dropped connection mid-save wipes the tab's items. Move it into one server action (or Postgres RPC) that swaps atomically. This will hit mobile users on restaurant Wi-Fi.
6. **Fix the guest even-split** so the payer is always a participant, and allocate rounding remainders so charges sum to the total.
7. **Add basic abuse limits:** a per-user/IP rate limit on the parse route and share-flow actions, `maxDuration` on the parse function, and a `unique(receipt_id, lower(venmo_username))` constraint on participants (concurrent joins currently create duplicate people who each get charged).
8. **Add indexes and eyes:** there are zero indexes on any foreign key (every dashboard load scans `receipt_participants`), and no error monitoring, so today nothing would tell you something broke. One migration of FK indexes + free-tier Sentry closes both.

> **Worth knowing, not blocking:** the shared-claim flow deliberately trades auth for frictionlessness – anyone with the link can claim as anyone on that receipt. Fine social-trust design for friends at dinner; just hold it as a conscious choice (a per-participant token would close it later). Also: migrations have no runner and the storage bucket's policies live only in the dashboard, so the database isn't reproducible from the repo – write down the setup before you have users. And since your `.env.local` keys were read during this review session, rotating the Supabase secret and Google AI keys is cheap peace of mind.

---

## Dimension 4 — Viable: can it ever cover its costs?

**Yes, comfortably – because the costs are tiny and the one real marginal cost (Gemini scans) is a natural meter to charge against.**

- **The real bar is ~$45/month, not $5.** At hobby scale the infra is nearly free – but Vercel's Hobby tier is non-commercial, so the moment you take money you're on Pro ($20/mo), and sustained growth pushes Supabase Pro ($25/mo). Plan monetization against that number.
- **Phase 1 (launch):** free + a tip link. At $2/1,000 scans you can absorb hundreds of users; don't build billing before anyone's asked to pay.
- **Phase 2 (if it sticks):** freemium metered on scans – e.g. 5 free scans/month, ~$2–3/mo unlimited. Scans are the only per-use cost, the payer (who gets the most value) is the one metered, and friends' claim links stay free forever – which protects the growth loop.
- **Premium surface later:** the payer's history is the asset – trips/events grouping multiple receipts, "who owes me across all tabs," exports, recurring groups. Those fit a supporter tier without paywalling the core split.
- **No referral path:** Venmo has no affiliate program, so deep links earn nothing – a multi-rail future (Zelle, Cash App, PayPal.me links) is about reach, not revenue.
- **Before taking money (and honestly before launch):** a privacy policy and account-deletion path – you hold emails, Venmo handles, and photos of what people bought.

---

## Feature backlog

P0 = the pre-release hardening pass above. P1 = first releases after launch. P2 = when there's traction. Effort: S ≈ hours, M ≈ a day or two, L ≈ a week+.

| # | Feature | Serves | Effort | Priority |
| --- | --- | --- | --- | --- |
| 1 | Hardening pass (must-fix list 1–8 above) | Feasible | M | P0 |
| 2 | Visible success/failure feedback: toast system, share errors, "link copied" | Good | S | P0 |
| 3 | Privacy policy + account deletion | Viable | S | P0 |
| 4 | Manual item entry: add/rename/delete lines, and a no-receipt tab | Useful | M | P1 |
| 5 | Scan-failure recovery: error message, retry parse, math check vs. stated total | Good · Useful | M | P1 |
| 6 | Non-Venmo participants: free-text name, owner records cash/offline payment | Useful | M | P1 |
| 7 | OG image + Web Share sheet + QR for tab links (the share link is the growth surface) | Viable | S | P1 |
| 8 | Confirmation dialogs for delete receipt / reopen editing / remove friend | Good | S | P1 |
| 9 | Auto-refresh claim views (poll or Supabase Realtime) – make "watch claims arrive" true | Good | M | P1 |
| 10 | Dashboard rollup: "you're owed $X," per-tab paid progress, hide/clean orphan tabs | Useful | M | P1 |
| 11 | Payment reminders: scheduled re-nudge for unpaid charges | Useful | M | P1 |
| 12 | Quantity-level claims (claim 1 of 3 beers – column already exists in the schema) | Useful | M | P2 |
| 13 | Per-participant claim tokens (stop link-holders acting as each other) | Feasible | M | P2 |
| 14 | Multi-rail settlement links: Zelle, Cash App, PayPal.me | Useful · Viable | M | P2 |
| 15 | PWA manifest + icons + install prompt | Good | S | P2 |
| 16 | Trips/events: group receipts, cross-tab balances, exports (premium candidate) | Viable | L | P2 |
| 17 | CI (lint + tsc + tests) and tests for server actions / claim flow | Feasible | M | P2 |
| 18 | Accessibility pass: focus traps, key handlers, aria-live, 44px targets | Good | M | P2 |

---

**How this review was done** – two parallel code audits (product surface: every route, component, and UX state · infrastructure: all 14 migrations, RLS policies, server actions, the Gemini route, and cost modeling), the highest-severity findings re-verified by direct reads, then a live walkthrough on a 390×844 viewport: guest sign-in, a real Gemini parse of a synthetic receipt, even split, share, a second no-login session claiming items, and the owner's close-and-collect flow. All test data created during the walkthrough (three receipts, photos, and the guest account) was removed from Supabase afterward.
