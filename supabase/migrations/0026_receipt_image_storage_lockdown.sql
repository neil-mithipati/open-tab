-- Receipt photographs are the most sensitive thing this app stores. A check
-- carries a card's last four digits, the cardholder's name, a merchant, a
-- location and a timestamp. Every other table is covered by RLS written down in
-- this directory; the bucket those photos live in was not covered by anything
-- in this directory at all.
--
-- That is the defect. `receipt-images` was created by hand in the dashboard, so
-- whatever policies guard it exist only in that project's console: they cannot
-- be reviewed in a diff, they are not recreated when the schema is rebuilt, and
-- nothing fails if someone widens them. The app has always signed its URLs
-- (there is not one getPublicUrl call in the codebase), which is evidence the
-- bucket was meant to be private — but "meant to be" is not a control. This
-- migration, together with `supabase/storage-policies.sql`, makes the bucket
-- and its policies part of the schema, so they are reviewable, reproducible and
-- testable like everything else.
--
-- ── why this file stops short of the bucket and its policies ───────────────
--
-- `storage.buckets` and `storage.objects` are owned by `supabase_storage_admin`
-- on a hosted Supabase project, not by the role `supabase db push` or the
-- dashboard SQL editor connects as, and `set role supabase_storage_admin` is
-- refused too. A statement here that touches either table aborts the whole
-- migration transaction with `must be owner of table objects` (SQLSTATE
-- 42501) partway through `db push` — which is exactly what happened the first
-- time this file tried to enable RLS on `storage.objects` and create policies
-- on it in the same transaction as the statements below.
--
-- So this file (0026) is only the `public.` half: the helper function the
-- storage policies call, and the retention function and index the purge job
-- calls. Both apply cleanly under `db push` because they own nothing in the
-- `storage` schema. The bucket privacy setting and the three storage policies
-- that reference `receipt_image_receipt_id` below live in
-- `supabase/storage-policies.sql` instead, with the dashboard procedure to
-- apply them documented in `docs/deployment.md`. Apply this file first — the
-- policies in that other file call the function this file creates.
--
-- ── the path convention this all rests on ──────────────────────────────────
--
-- Objects are stored at `<user id>/<receipt id>.<ext>`, written by
-- CaptureStep.tsx and re-derived by boundStoragePath() in src/lib/storage.ts,
-- which every server-side reader of image_url goes through. Two facts follow
-- from it and both are used below:
--
--   * the first path segment is the uploader, so a write can be pinned to
--     auth.uid() without a table lookup;
--   * the second names the receipt, so a read can be resolved to the same
--     owner-or-participant question `receipts` itself already answers.
--
-- Reading the receipt id out of the name is what lets a PARTICIPANT see the
-- photo. Participants do not share the owner's path prefix, so a prefix-only
-- policy — the shape every Supabase storage example reaches for — would lock
-- out exactly the people the app is built to show the check to.
--
-- ── additive only ─────────────────────────────────────────────────────────
--
-- No table, column, index or row is dropped, and no application data is read or
-- rewritten. The one `drop function if exists` line below names an object this
-- migration recreates on the very next statement; it exists so re-running the
-- file is safe, which is the same shape 0009 and 0019 used. (The function drop
-- is not optional dressing: a `create or replace` cannot change a function's
-- OUT columns, so without it a second run of this file against a project that
-- already has an older receipt_images_due_for_purge would fail.)
--
-- DEPLOYMENT ORDER: apply this BEFORE deploying the code that ships with it,
-- and BEFORE applying `supabase/storage-policies.sql` (see docs/deployment.md).
-- It is backward compatible with what is deployed now — today's client already
-- uploads to `<user id>/<receipt id>.<ext>` and already reads through signed
-- URLs — so nothing breaks in the window between the two.

-- ---------------------------------------------------------------------------
-- 1. name → receipt id
-- ---------------------------------------------------------------------------
--
-- Returns null rather than raising for anything that is not exactly
-- `<segment>/<uuid>.<ext>`. That matters: a policy that throws takes the whole
-- statement with it, so a single object with an odd name would break reads for
-- every other object in the same query. Null flows through the comparisons
-- below as "not true", which denies — the direction a policy helper should
-- fail.
--
-- No table access, so no security definer and no search_path games are needed;
-- it is pure text handling over its argument.
create or replace function public.receipt_image_receipt_id(object_name text)
returns uuid language sql immutable as $$
  select case
    when split_part(object_name, '/', 2) ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+$'
    then split_part(split_part(object_name, '/', 2), '.', 1)::uuid
  end
$$;

comment on function public.receipt_image_receipt_id(text) is
  'Receipt id encoded in a receipt-images object name (<user id>/<receipt id>.<ext>). Null for any name that does not match that shape, so storage policies deny rather than raise on an unexpected object. The policies that call this live in supabase/storage-policies.sql, applied via the Supabase dashboard — see docs/deployment.md.';

-- ---------------------------------------------------------------------------
-- 2. retention: the image is not kept forever
-- ---------------------------------------------------------------------------
--
-- Once a receipt is parsed, the photo has done its job — the line items are in
-- `receipt_items` and nothing in the product reads the pixels again except a
-- thumbnail. Keeping it indefinitely is a growing pile of card numbers with no
-- remaining purpose, so it is deleted N days after the parse. N lives in the
-- application (RECEIPT_IMAGE_RETENTION_DAYS, default 7); this function takes
-- the resulting cutoff so there is exactly one place the number is configured.
--
-- Which timestamp counts as "the parse":
--
--   * parsed_at (0020) is the claim, and 0025 can set it back to null when a
--     transient provider failure hands the claim back — so on its own it would
--     let a receipt fall out of the purge set;
--   * last_parse_attempt_at (0025) is never cleared, so it survives a release.
--
-- GREATEST ignores nulls unless every argument is null, so `greatest(parsed_at,
-- last_parse_attempt_at)` is the most recent parse activity of any kind, and is
-- null only for a receipt that has never been attempted.
--
-- Those never-attempted rows are the second branch. An upload abandoned between
-- the storage write and the parse call leaves an image attached to a receipt
-- that carries neither timestamp, and it is exactly as sensitive as a parsed
-- one. It is aged out on created_at at the same N, which is the widest this
-- can be while still honouring "N days after parse" for everything that was
-- parsed.
--
-- Rows whose image_url is already null are skipped, which is what stops the job
-- reselecting the same receipt forever: the caller nulls the column after the
-- object is gone.
--
-- security definer because the caller is a cron route holding the service key,
-- and a future non-service caller must not be handed a way to read image_url
-- across every account — the function returns only what the job needs and takes
-- no user input beyond a timestamp.
--
-- created_by is returned alongside the pointer, and it is a security control
-- rather than a convenience. image_url is a column the row's owner can write
-- anything into, so the job must not delete whatever object the string happens
-- to name: it re-derives `<created_by>/<id>.<ext>` through boundStoragePath()
-- and skips anything that does not match. Without the owner in this result the
-- job would have nothing to bind against, and a receipt carrying a hand-written
-- pointer at someone else's object would delete that object on a schedule.
drop function if exists public.receipt_images_due_for_purge(timestamptz);
create function public.receipt_images_due_for_purge(p_before timestamptz)
returns table (id uuid, created_by uuid, image_url text)
language sql security definer set search_path = public as $$
  select r.id, r.created_by, r.image_url
  from public.receipts r
  where r.image_url is not null
    and (
      greatest(r.parsed_at, r.last_parse_attempt_at) < p_before
      or (
        r.parsed_at is null
        and r.last_parse_attempt_at is null
        and r.created_at < p_before
      )
    )
$$;

comment on function public.receipt_images_due_for_purge(timestamptz) is
  'Receipts whose stored photo is older than the retention cutoff, with the owner the purge job binds the stored path to: parsed rows aged on the later of parsed_at and last_parse_attempt_at, never-parsed rows aged on created_at. Returns only rows that still have an image_url, so a purged receipt is not selected twice.';

-- The purge scans for old rows that still hold an image. Almost every row is
-- excluded by the partial predicate once the job has run a few times, so the
-- index stays small; created_at orders the never-parsed branch and bounds the
-- other one, since a receipt cannot be parsed before it was created.
create index if not exists idx_receipts_image_retention
  on public.receipts (created_at)
  where image_url is not null;
