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
-- migration makes the bucket and its policies part of the schema, so they are
-- reviewable, reproducible and testable like everything else.
--
-- ── the path convention this all rests on ──────────────────────────────────
--
-- Objects are stored at `<user id>/<receipt id>.<ext>`, written by
-- CaptureStep.tsx and re-derived by the parse route's ownStoragePath(). Two
-- facts follow from it and both are used below:
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
-- No table, column, index, row or function is dropped, and no application data
-- is read or rewritten. The two `drop policy if exists` lines below name
-- policies this migration creates on the very next statement; they exist so
-- re-running the file is safe, which is the same shape 0009 and 0019 used.
-- Turning the bucket private is a configuration change, not a data change, and
-- it is the whole point of the task.
--
-- DEPLOYMENT ORDER: apply this BEFORE deploying the code that ships with it.
-- It is backward compatible with what is deployed now — today's client already
-- uploads to `<user id>/<receipt id>.<ext>` and already reads through signed
-- URLs — so nothing breaks in the window between the two.

-- ---------------------------------------------------------------------------
-- 1. the bucket is private
-- ---------------------------------------------------------------------------
--
-- `public = false` is what closes /storage/v1/object/public/<bucket>/<name>.
-- With it set, that route answers 400 "Bucket not found" to everyone including
-- the owner, and the only way to read an object is a signed URL or an
-- authenticated request that satisfies the policies below.
--
-- Insert-then-update rather than a bare update so this file also stands up the
-- bucket from nothing on a fresh project. The conflict branch sets `public`
-- and nothing else on purpose: file_size_limit and allowed_mime_types are
-- whatever the live project already has, they are not the control this task is
-- about, and overwriting live upload constraints during a security fix is how a
-- security fix becomes an outage.
insert into storage.buckets (id, name, public)
values ('receipt-images', 'receipt-images', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- 2. name → receipt id
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
  'Receipt id encoded in a receipt-images object name (<user id>/<receipt id>.<ext>). Null for any name that does not match that shape, so storage policies deny rather than raise on an unexpected object.';

-- ---------------------------------------------------------------------------
-- 3. policies on storage.objects
-- ---------------------------------------------------------------------------
--
-- Already on in a Supabase project; restated so a rebuilt schema cannot end up
-- with these policies present and unenforced.
alter table storage.objects enable row level security;

-- Every policy below is granted `to authenticated` only. There is deliberately
-- no policy for `anon`, and that omission IS the anonymous-read control: RLS
-- denies by default, so a request carrying the publishable key and no session
-- matches no policy and reads nothing. Note that anonymous SIGN-IN (0013) still
-- produces a real session with a real auth.uid(), so those users are
-- `authenticated` here and are held to the same owner-or-participant test as
-- everyone else — they do not get in through this door either.

-- READ. The owner of the receipt, or anyone the receipt lists as a participant.
-- Both questions are asked through the security definer helpers 0009 added, for
-- the reason 0009 added them: the lookup must not re-enter `receipts`' or
-- `receipt_participants`' own policies.
--
-- Note what is NOT here: the path prefix. A participant's user id is not the
-- first path segment — the uploader's is — so pinning reads to the prefix would
-- deny every participant. Ownership is established from the receipt row instead,
-- which is the same source of truth receipts_select_participant uses.
drop policy if exists "receipt_images_select_owner_or_participant" on storage.objects;
create policy "receipt_images_select_owner_or_participant" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipt-images'
    and (
      public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()
      or public.is_receipt_participant(public.receipt_image_receipt_id(name))
    )
  );

-- WRITE. Both halves are required and they guard different things.
--
--   * the prefix check stops a user writing into another user's folder, which
--     is what the parse route's ownStoragePath() regex assumes when it decides
--     a stored path belongs to the caller;
--   * the ownership check stops a user parking an object under their OWN prefix
--     but named with someone else's receipt id — which the read policy above
--     resolves by receipt id, so without this half an attacker could plant a
--     name that makes their object readable by a victim's participants, or
--     collide with a name the victim's own upload wants.
--
-- A malformed name yields a null receipt id, receipt_creator_id(null) is null,
-- and `null = auth.uid()` is not true — so the naming convention the rest of
-- the code depends on is enforced here rather than merely hoped for.
drop policy if exists "receipt_images_insert_own" on storage.objects;
create policy "receipt_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipt-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()
  );

-- DELETE. Owner only, on the same two-part test. Participants can see the check
-- but cannot destroy the payer's copy of it. This is the policy the discard
-- path in ReceiptSplitStep runs under; it removes the object before deleting
-- the receipt row, so the ownership lookup still resolves.
drop policy if exists "receipt_images_delete_own" on storage.objects;
create policy "receipt_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipt-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.receipt_creator_id(public.receipt_image_receipt_id(name)) = auth.uid()
  );

-- There is no UPDATE policy, and that is deliberate rather than an oversight.
-- Nothing in the app overwrites an object: uploads are plain inserts with no
-- upsert, and a retry reuses the image already stored rather than replacing it.
-- Without an update policy, an object's bytes cannot be swapped after the fact
-- for a receipt someone else has already reviewed.

-- ---------------------------------------------------------------------------
-- 4. retention: the image is not kept forever
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
create or replace function public.receipt_images_due_for_purge(p_before timestamptz)
returns table (id uuid, image_url text)
language sql security definer set search_path = public as $$
  select r.id, r.image_url
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
  'Receipts whose stored photo is older than the retention cutoff: parsed rows aged on the later of parsed_at and last_parse_attempt_at, never-parsed rows aged on created_at. Returns only rows that still have an image_url, so a purged receipt is not selected twice.';

-- The purge scans for old rows that still hold an image. Almost every row is
-- excluded by the partial predicate once the job has run a few times, so the
-- index stays small; created_at orders the never-parsed branch and bounds the
-- other one, since a receipt cannot be parsed before it was created.
create index if not exists idx_receipts_image_retention
  on public.receipts (created_at)
  where image_url is not null;
