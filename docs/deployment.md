# Deployment notes

## Checking the live database against the repo (OT-145)

    npm run check:drift

Compares the linked Supabase project with this checkout and exits non-zero if
they disagree. Three things:

- every file in `supabase/migrations/` is recorded in
  `supabase_migrations.schema_migrations`, and nothing is recorded there that
  the repo does not have — both directions;
- the policies on `storage.objects` match `supabase/storage-policies.sql`;
- the `public` flag on every bucket the repo declares.

**When to run it.** Before a deploy, after applying a migration, after
touching anything in the dashboard's Storage UI, and any time a bug looks like
"the code reads a column that isn't there." OT-142 found production ~14
migrations behind with the migration history table completely empty; that was
invisible until a migration happened to fail. This is the check that sees it.

**Exit codes. The third one is the point:**

| code | meaning |
|---|---|
| 0 | checked, live matches the repo |
| 1 | checked, drift found — listed on stdout |
| 2 | **could not check** — not linked, CLI missing, query failed. Nothing was verified. Not a pass. |

**Prerequisites.** The Supabase CLI on `PATH` (or `SUPABASE_BIN` set to it),
logged in with `supabase login`, and run from a checkout that has been linked
with `supabase link`. A git worktree has no link of its own — `supabase/.temp/`
is gitignored — so run this from the main checkout, not from `../wt-*`.

**This is not a gate,** deliberately. Gates run inside worktrees with no
network and no linked project; a required gate that needs a database would fail
every task. `.claude/gates.json` is untouched.

**It compares expressions, not names.** The dashboard appends its own suffix to
every policy name (`receipt_images_delete_own 13hfyy5_0`), so a live name never
equals a declared one. Both sides are parsed and rendered to a canonical form
that ignores redundant parentheses, casts, a leading `public.` qualifier,
keyword case, and the order of AND/OR operands — and nothing else. A policy is
matched on (command, roles, permissive/restrictive, USING, WITH CHECK), one for
one, so the extra `…_1` row the dashboard creates when two operations are
ticked on one policy is reported as an undeclared live policy.

**What has not been verified.** The comparison logic is unit-tested against
fixtures, and the script's exit codes are tested end to end against a stub CLI
(`src/__tests__/scripts/schemaDrift.test.ts`). It has never been run against a
hosted project — that needs the owner. The one thing to confirm on the first
real run is that `supabase db query --linked` returns rows in a shape the
script recognises; if it does not, it exits **2** with "could not find a result
set in the supabase CLI output", never 0.

## Applying the receipt-images storage policies (OT-143)

`supabase/migrations/0026_receipt_image_storage_lockdown.sql` used to also
carry the `receipt-images` bucket privacy setting and its three storage
policies. `supabase db push` against a hosted project failed inside it:

    ERROR: must be owner of table objects (SQLSTATE 42501)
    At statement: 3
    alter table storage.objects enable row level security

`storage.buckets` and `storage.objects` are owned by `supabase_storage_admin`
on a hosted project. Neither `supabase db push` nor the dashboard SQL editor
connects as that role, and `set role supabase_storage_admin` is refused too.
So that half cannot be applied by any automated SQL path on a hosted project —
it has to go through the dashboard's Storage UI, which does have the rights.

**Dependency:** apply `0026` first. Every policy below calls
`public.receipt_image_receipt_id`, which `0026` creates. Applying the policies
before `0026` fails with "function does not exist".

The exact expressions are versioned in `supabase/storage-policies.sql` — that
file is the source of truth for what the dashboard settings below must match.
It is not runnable as a SQL script against a hosted project for the same
ownership reason as above; it exists so the text is reviewable in a diff, not
so it can be pasted into the SQL editor.

**Procedure, once `0026` is applied:**

1. Storage > Buckets > `receipt-images` > turn the "Public bucket" toggle OFF.
   (If the bucket does not exist yet, create it first, named `receipt-images`,
   not public.)
2. Storage > Policies > `receipt-images` > New policy, three times, one per
   operation below. For each: paste the expression from
   `supabase/storage-policies.sql`, and tick only the one operation named —
   ticking more than one on the delete policy makes the dashboard silently
   split it into two separate rows (see `supabase/storage-policies.sql` for
   why that's harmless but not what's declared).
   - `receipt_images_select_owner_or_participant` — SELECT only, target
     role `authenticated`, USING expression from the file.
   - `receipt_images_insert_own` — INSERT only, target role `authenticated`,
     WITH CHECK expression from the file.
   - `receipt_images_delete_own` — DELETE only, target role `authenticated`,
     USING expression from the file.
   - Do not create an UPDATE policy for this bucket.

**After applying, run `npm run check:drift`** (see the first section of this
file). It reads the live policies back and compares their expressions against
this file, which is how you find out whether the dashboard did what you meant —
including the extra SELECT row it splits off if you tick two operations on the
delete policy.

## `supabase/migrations/0020_receipts_parsed_at.sql` — apply BEFORE the next code deploy (OT-123, merged)

OT-123 closes the last gap in the parse-replay defense: a receipt whose parse
produced nothing (blank/unreadable photo, or a thrown Gemini error) used to be
indistinguishable from an unparsed one, so it could be re-submitted forever off
one upload. The route now stamps `parsed_at` on the row **before** calling
Gemini, so the claim is consumed whether or not the parse succeeds.

The claim is deliberately fail-closed. **If 0020 is applied after this code
deploys, every parse errors (`42703`, undefined column) and returns 503 —
scanning is down for every user until the migration runs.** 0020 is backward
compatible with the currently deployed code, so apply it first, or in the same
deploy step before the new build serves traffic. Same ordering rule as 0015,
0016, and 0019 below.

## Receipt photo storage ceiling raised (OT-104, merged)

Receipt photos are now compressed on-device before upload (downscaled and
re-encoded to JPEG) instead of uploading the raw phone photo. Same Supabase
free-tier storage budget now holds roughly 25x more receipts, and Gemini
parses run faster against the smaller image.

`/api/receipts/parse` also now enforces server-side caps: the fetched image
must be 10 MB or smaller and its MIME type must be `image/jpeg`,
`image/png`, `image/webp`, or `image/heic`, or the route returns 400
`{ error: "bad_image" }`. No config change needed for this — it's
enforced in route code — but note it if a future upload path needs to stay
under these limits.

## Migrations 0015 and 0016 — APPLIED 2026-08-19

Both applied to the live database by the owner on 2026-08-19. The duplicate
check for 0016 returned no rows, so the unique index applied clean.

Note the ordering consequence: 0015 locks `profiles` to own-row-only, and any
build predating OT-103 reads `profiles` directly from the browser. Such a build
now renders empty friend lists, empty friend search, and non-resolving invite
links. Current main is correct; older builds are not.

The original notes follow, kept for context.

**`supabase/migrations/0016_participant_unique_and_save_rpc.sql` — apply
BEFORE or WITH the next code deploy, not after.**

OT-105 (merged) replaces the browser-side delete-then-reinsert save paths
with a single atomic `save_receipt_state` RPC (`security definer`,
owner-checked against `auth.uid()`), called from a new server action
(`src/app/actions/saveReceipt.ts`) instead of sequential client round-trips.
The migration also adds a unique index on
`receipt_participants (receipt_id, lower(venmo_username))` to stop
concurrent claim joins from creating duplicate, separately-charged
participants.

The merged code already calls the new RPC — **apply this migration first**,
same as 0015 below. Before applying, run the dedupe check query in the
migration's header comment; if it returns rows, dedupe those participants
before applying the unique index, or the migration will fail.

**`supabase/migrations/0015_profiles_rls_and_friendship_check.sql` — apply
BEFORE or WITH the next code deploy, not after.**

OT-103 (merged) locks down `profiles`: the old `profiles_select_all` policy
(`using (true)`, readable by anyone with the anon key) is dropped and replaced
with an own-row policy. Cross-user reads that used to hit `profiles` directly
now go through scoped `security definer` functions
(`get_profile_by_invite_token`, `list_friend_profiles`,
`find_profile_by_venmo_username`), and `add_friendship` now rejects any call
where the caller is not one of the two users being friended.

The merged client code already calls the new functions. **If migration 0015
is not applied first:**

- Every invite page 404s (`get_profile_by_invite_token` doesn't exist yet).
- Friend search returns empty (`list_friend_profiles` doesn't exist yet).
- Adding an on-platform friend silently misroutes into `external_contacts`
  instead of creating a real friendship, because the client-side fallback
  can't tell "function missing" from "not a real user."

Apply 0015 to the Supabase project first (or in the same deploy step, before
the new build serves traffic), then deploy the code. Do not deploy code and
migration out of order.

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
