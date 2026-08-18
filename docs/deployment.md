# Deployment notes

## `NEXT_PUBLIC_APP_URL` is required in production

Share links and QR codes are built from `NEXT_PUBLIC_APP_URL`
(`src/lib/qr/inviteUrl.ts`). Previously, if the var was unset it silently fell
back to `http://localhost:3000` — every share link and QR code a real user
generated would point at localhost, with no error anywhere.

As of OT-101 (merged `37b3183`), `appBaseUrl()` still falls back to
`localhost:3000` in development, but throws
`"NEXT_PUBLIC_APP_URL must be set in production"` if the var is unset and
`NODE_ENV === "production"`.

**Before deploying:** set `NEXT_PUBLIC_APP_URL` in the hosting provider's env
config (e.g. Vercel project settings) to the app's real public URL.

**Rebuild required after changing it.** This is a `NEXT_PUBLIC_*` variable, so
Next.js inlines its value into the client bundle at build time. Changing it in
the hosting dashboard and just restarting the app is not enough — trigger a
new build/deploy for the new value to take effect.

Known gaps, not yet fixed (see `ledger/OT-112.md` and reviewer findings on
OT-101): the var is not yet documented in `.env.example`, so nothing prompts a
new deployer to set it; the throw happens in `buildTabUrl`, which currently
runs *after* `shareReceipt` has already persisted `shared` status and written
a token (retry is safe since the token is reused, but boot-time env
validation would fail faster).

## `/api/receipts/parse` needs a 60s function timeout

As of OT-102 (merged), the route exports `export const maxDuration = 60;` to
give slow Gemini calls room to finish instead of hitting the platform
default timeout. Confirm the hosting provider's function/route timeout
config allows at least 60s for this route (e.g. Vercel plan limits — Hobby
caps at 60s already, Pro/Enterprise can go higher but won't unless
`maxDuration` is honored by the deployment config).
