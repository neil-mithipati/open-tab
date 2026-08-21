-- Storage half of the receipt-images lockdown (OT-143, split from migration
-- 0026 — read that file's header first, it explains why this is not a
-- migration).
--
-- `storage.buckets` and `storage.objects` are owned by `supabase_storage_admin`
-- on a hosted Supabase project. Neither `supabase db push` nor the dashboard
-- SQL editor connects as that role, and `set role supabase_storage_admin` is
-- refused too (`permission denied to set role`). So nothing in this file can
-- be run as a raw SQL script against a hosted project — it is NOT applied by
-- `supabase db push`, and pasting it into the SQL editor will fail the same
-- way 0026 did.
--
-- This file exists so the policy TEXT is versioned and reviewable, not so it
-- can be executed as-is. The apply procedure — clicking these same
-- expressions into the dashboard's Storage > Policies UI, which does have the
-- rights this role doesn't — is documented in docs/deployment.md under
-- "Applying the receipt-images storage policies". That doc states the
-- dependency stated here too: `supabase/migrations/0026_...sql` must be
-- applied first, because every expression below calls
-- `public.receipt_image_receipt_id`, which 0026 creates.
--
-- Kept byte-for-byte identical in shape to what 0026 carried before the split,
-- so a diff against migration history shows only that the statements moved,
-- not that they changed.

-- ---------------------------------------------------------------------------
-- 1. the bucket is private
-- ---------------------------------------------------------------------------
--
-- `public = false` is what closes /storage/v1/object/public/<bucket>/<name>.
-- With it set, that route answers 400 "Bucket not found" to everyone including
-- the owner, and the only way to read an object is a signed URL or an
-- authenticated request that satisfies the policies below.
--
-- On the dashboard this is the "Public bucket" toggle on the `receipt-images`
-- bucket, in Storage > Buckets — turn it OFF. This insert form is kept here
-- as the versioned record of what that toggle must resolve to, and as the
-- statement a from-scratch local `supabase start` project can run (local
-- Postgres connects as a superuser, so this file DOES apply cleanly there,
-- unlike on a hosted project).
insert into storage.buckets (id, name, public)
values ('receipt-images', 'receipt-images', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- 2. row level security is on
-- ---------------------------------------------------------------------------
--
-- Already on in every hosted Supabase project — this line is a no-op there,
-- which is exactly why it must not sit in a path `db push` executes: it was
-- statement 3 of the original 0026 and the one the ownership error aborted
-- on. Restated here defensively so a from-scratch local project (where this
-- file runs as a superuser) ends up with RLS enabled too.
alter table storage.objects enable row level security;

-- ---------------------------------------------------------------------------
-- 3. policies on storage.objects
-- ---------------------------------------------------------------------------
--
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
--
-- Dashboard name: "receipt_images_select_owner_or_participant". Operation:
-- SELECT. Target roles: authenticated.
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
--     is what boundStoragePath() assumes when it decides a stored path belongs
--     to the receipt it is recorded on;
--   * the ownership check stops a user parking an object under their OWN prefix
--     but named with someone else's receipt id — which the read policy above
--     resolves by receipt id, so without this half an attacker could plant a
--     name that makes their object readable by a victim's participants, or
--     collide with a name the victim's own upload wants.
--
-- A malformed name yields a null receipt id, receipt_creator_id(null) is null,
-- and `null = auth.uid()` is not true — so the naming convention the rest of
-- the code depends on is enforced here rather than merely hoped for.
--
-- Dashboard name: "receipt_images_insert_own". Operation: INSERT. Target
-- roles: authenticated. This is a WITH CHECK expression, not USING — the
-- dashboard's "policy definition" field for an INSERT policy.
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
--
-- Dashboard name: "receipt_images_delete_own". Operation: DELETE only — tick
-- ONLY the DELETE checkbox. Ticking SELECT alongside it makes the dashboard
-- silently create a second, separate SELECT policy with the same USING
-- expression (observed live, see ledger/OT-143.md); that extra row is
-- harmless here because its expression is a strict subset of the read policy
-- above and policies OR together, but it is not what this file declares, so
-- do not tick it.
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
-- for a receipt someone else has already reviewed. Do not create one in the
-- dashboard.
