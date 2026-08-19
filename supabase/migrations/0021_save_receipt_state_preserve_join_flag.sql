-- Carry a participant's share-join provenance across an owner's save.
--
-- The defect: 0016's save_receipt_state re-inserts receipt_participants
-- without listing joined_via_share, so every row comes back at that column's
-- 0011 default of false. ClaimOwnerView filters the owner's claimer list on
-- exactly that flag, so one owner edit made every genuine share-link claimer
-- vanish from the owner's own view of the tab — on a 25-person dinner, the
-- case this app exists for.
--
-- The complication, and why this migration is bigger than one column name:
-- the claim-join rate limiter (OT-115) had been fixed by counting only rows
-- with joined_via_share = true, deliberately leaning on this erasure, because
-- a save's re-inserted rows also carry a fresh created_at and would otherwise
-- fill the 20/hr cap instantly and lock a live share link. Restoring the flag
-- on its own would hand that lockout straight back. So the limiter is given a
-- clock the save does not touch here, and src/lib/rateLimit.ts moves onto it
-- in the same change.
--
-- What does NOT change: the delete-then-re-insert, and the fact that the whole
-- swap happens inside one function call and therefore one transaction. That
-- atomicity is the reason 0016 exists and is not renegotiated here — the prior
-- values are read into a local before the delete and written back on the
-- insert, in the same statement sequence, so a save still either lands whole
-- or leaves the tab untouched.
--
-- Additive only: one new nullable column and a function body replacement. No
-- table, column, index, grant, or row is dropped, and no existing row is
-- rewritten.
--
-- Not fixed here, so nobody assumes it was: claim_done_at is still reset by a
-- save. It is the same shape of bug — a claimer who tapped "done" reads as
-- still claiming after the owner edits a line — but it is not in this task's
-- criteria, and the fix is the same two lines whenever it is picked up.

-- ── a join time the owner's save does not reset ──────────────────────────────
-- created_at (0017) cannot serve as one. The save deletes the row and inserts
-- a different one, so created_at is honestly a row-creation time and refreshes
-- every save. joined_at is the person's join time, and the function below
-- carries it across the swap.
--
-- Added bare, then defaulted, in two statements on purpose. `add column ...
-- default now()` writes now() into every existing row, and a receipt with 20
-- share-joined participants would then read as 20 joins in the last hour and
-- lock its own link for an hour the moment this ships. Adding the column with
-- no default leaves existing rows null; setting the default afterwards applies
-- only to rows inserted from here on. Nothing is written to existing data.
--
-- Null therefore means "joined before this shipped". Null is not >= anything,
-- so the limiter's `joined_at >= one hour ago` never matches those rows: they
-- under-count, which is the direction a rate limiter should fail. The function
-- below fills each one in from its created_at the first time its receipt is
-- saved.
alter table public.receipt_participants
  add column if not exists joined_at timestamptz;

alter table public.receipt_participants
  alter column joined_at set default now();

comment on column public.receipt_participants.joined_at is
  'When this person joined the receipt. Unlike created_at it survives save_receipt_state''s delete-and-re-insert, so the claim-join rate limiter counts real joins rather than the owner''s last save. Null means the row predates migration 0021.';

-- ── the same atomic save, now carrying the two columns through ───────────────
-- Identical to 0016 apart from: v_prior, which is read before the delete;
-- joined_via_share and joined_at on the participants the insert writes; and
-- the wider column list on that insert. Payload shapes, ids, ownership check,
-- delete order, assignment and charge handling, and the receipts update are
-- unchanged. p_participants gains no key — provenance belongs to the row that
-- is already there, not to whatever the browser last held.

create or replace function public.save_receipt_state(
  p_receipt_id uuid,
  p_items jsonb default '[]'::jsonb,
  p_participants jsonb default '[]'::jsonb,
  p_assignments jsonb default '[]'::jsonb,
  p_charges jsonb default '[]'::jsonb,
  p_receipt jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_items jsonb;
  v_participants jsonb;
  v_item_ids jsonb;
  v_participant_ids jsonb;
  v_prior jsonb;
begin
  if auth.uid() is null then
    raise exception 'save_receipt_state: not signed in' using errcode = '42501';
  end if;

  select created_by into v_owner from receipts where id = p_receipt_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'save_receipt_state: caller does not own this receipt'
      using errcode = '42501';
  end if;

  -- Everything the delete below is about to destroy that the payload cannot
  -- replace, keyed the way 0016's unique index keys the table:
  -- (receipt_id, lower(venmo_username)). Read here, written back on the
  -- insert, both inside this one call.
  --
  -- coalesce(joined_at, created_at) backfills rows that predate this
  -- migration lazily, with their real creation time rather than now(), so an
  -- owner save cannot make an old participant look like a new joiner.
  select coalesce(
           jsonb_object_agg(
             lower(rp.venmo_username),
             jsonb_build_object(
               'joined_via_share', rp.joined_via_share,
               'joined_at', coalesce(rp.joined_at, rp.created_at)
             )
           ),
           '{}'::jsonb
         )
    into v_prior
  from receipt_participants rp
  where rp.receipt_id = p_receipt_id;

  -- Mint the new ids before touching anything, so the inserts below can be
  -- written straight from these arrays.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', gen_random_uuid(),
               'client_id', i.client_id,
               'name', i.name,
               'price', i.price,
               'quantity', coalesce(i.quantity, 1),
               'sort_order', coalesce(i.sort_order, 0)
             )
             order by coalesce(i.sort_order, 0)
           ),
           '[]'::jsonb
         )
    into v_items
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as i(client_id text, name text, price numeric, quantity int, sort_order int);

  -- A username already on this receipt keeps its provenance and its join
  -- time; one the payload introduces is new, so it did not join via the share
  -- link and it joins now.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', gen_random_uuid(),
               'client_id', p.client_id,
               'user_id', p.user_id,
               'venmo_username', p.venmo_username,
               'display_name', p.display_name,
               'is_owner', coalesce(p.is_owner, false),
               'joined_via_share',
                 coalesce(
                   (v_prior -> lower(p.venmo_username) ->> 'joined_via_share')::boolean,
                   false
                 ),
               'joined_at',
                 coalesce(
                   (v_prior -> lower(p.venmo_username) ->> 'joined_at')::timestamptz,
                   now()
                 )
             )
           ),
           '[]'::jsonb
         )
    into v_participants
  from jsonb_to_recordset(coalesce(p_participants, '[]'::jsonb))
    as p(client_id text, user_id uuid, venmo_username text,
         display_name text, is_owner boolean);

  -- Out with the old. Participants cascade to charges and item_assignments,
  -- items cascade to item_assignments; charges are cleared explicitly so a
  -- save that produces none leaves none behind.
  delete from charges where receipt_id = p_receipt_id;
  delete from receipt_participants where receipt_id = p_receipt_id;
  delete from receipt_items where receipt_id = p_receipt_id;

  insert into receipt_items (id, receipt_id, name, price, quantity, sort_order)
  select r.id, p_receipt_id, r.name, r.price, r.quantity, r.sort_order
  from jsonb_to_recordset(v_items)
    as r(id uuid, name text, price numeric, quantity int, sort_order int);

  insert into receipt_participants
    (id, receipt_id, user_id, venmo_username, display_name, is_owner,
     joined_via_share, joined_at)
  select r.id, p_receipt_id, r.user_id, r.venmo_username, r.display_name,
         r.is_owner, r.joined_via_share, r.joined_at
  from jsonb_to_recordset(v_participants)
    as r(id uuid, user_id uuid, venmo_username text, display_name text,
         is_owner boolean, joined_via_share boolean, joined_at timestamptz);

  select coalesce(jsonb_object_agg(r.client_id, r.id), '{}'::jsonb)
    into v_item_ids
  from jsonb_to_recordset(v_items) as r(client_id text, id uuid);

  select coalesce(jsonb_object_agg(r.client_id, r.id), '{}'::jsonb)
    into v_participant_ids
  from jsonb_to_recordset(v_participants) as r(client_id text, id uuid);

  -- Assignments and charges reference client ids; anything pointing at a row
  -- that is no longer in the payload is dropped rather than failing the save.
  insert into item_assignments (receipt_item_id, participant_id)
  select (v_item_ids ->> a.item_client_id)::uuid,
         (v_participant_ids ->> a.participant_client_id)::uuid
  from jsonb_to_recordset(coalesce(p_assignments, '[]'::jsonb))
    as a(item_client_id text, participant_client_id text)
  where v_item_ids ? a.item_client_id
    and v_participant_ids ? a.participant_client_id
  on conflict (receipt_item_id, participant_id) do nothing;

  insert into charges
    (receipt_id, from_user_id, to_participant_id, amount, venmo_link, paid_at)
  select p_receipt_id, v_owner,
         (v_participant_ids ->> c.participant_client_id)::uuid,
         c.amount, c.venmo_link, c.paid_at
  from jsonb_to_recordset(coalesce(p_charges, '[]'::jsonb))
    as c(participant_client_id text, amount numeric,
         venmo_link text, paid_at timestamptz)
  where v_participant_ids ? c.participant_client_id;

  update receipts r set
    status = case when p_receipt ? 'status'
                  then p_receipt ->> 'status' else r.status end,
    split_mode = case when p_receipt ? 'split_mode'
                      then p_receipt ->> 'split_mode' else r.split_mode end,
    merchant_name = case when p_receipt ? 'merchant_name'
                         then p_receipt ->> 'merchant_name' else r.merchant_name end,
    subtotal = case when p_receipt ? 'subtotal'
                    then (p_receipt ->> 'subtotal')::numeric else r.subtotal end,
    tax = case when p_receipt ? 'tax'
               then (p_receipt ->> 'tax')::numeric else r.tax end,
    tip = case when p_receipt ? 'tip'
               then (p_receipt ->> 'tip')::numeric else r.tip end,
    total = case when p_receipt ? 'total'
                 then (p_receipt ->> 'total')::numeric else r.total end
  where r.id = p_receipt_id;

  return jsonb_build_object(
    'item_ids', v_item_ids,
    'participant_ids', v_participant_ids
  );
end;
$$;

-- Restated rather than assumed: `create or replace` keeps the existing grants,
-- and these are the same ones 0016 set.
revoke execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated, service_role;
