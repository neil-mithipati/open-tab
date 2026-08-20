-- Stop an owner's save from destroying a claim that landed after its snapshot.
--
-- The defect, pre-existing since 0016 and unchanged by 0021 and 0022:
-- save_receipt_state deletes every receipt_items row and mints a fresh id for
-- each one on the way back in, and item_assignments.receipt_item_id cascades
-- from the item side (0005). The participant swap re-mints ids too, and
-- charges.to_participant_id cascades from that side (0007). So a claim made
-- through the share link after the owner's browser took its snapshot dies in
-- the swap — along with the charge raised against it — even when the claimer's
-- own row is preserved perfectly.
--
-- 0022 closed the neighbouring window: a claimer the payload does not name at
-- all now leaves the save refused with PT409 rather than deleted. That path is
-- carried through here untouched. This one is the window it could not reach,
-- and a PT409 walks the owner straight into it: the refusal says reload, the
-- reload pulls the new claimer into the payload, and the next save destroys
-- what she claimed while reporting success.
--
-- Concretely, against a real database on 0022: carol's row survives, her claim
-- on the fries is gone, her charge is gone, and the call returns normally.
--
-- ── the fix, in three parts ────────────────────────────────────────────────
--
-- 1. Items keep the ids the payload already knows. The client sends the row id
--    it read (EditableItem.dbId, already carried by the editor and by the
--    share flow); an id that names a live row on this receipt is re-used
--    instead of minting a new one. Anything else — a new item, or an id
--    belonging to some other tab — still gets gen_random_uuid(), so a payload
--    cannot reach a row it was not given. That is what gives an item stable
--    identity across a save: the fries the owner is editing and the fries a
--    claimer has open in another browser are the same row afterwards.
--
-- 2. Claims made through the share link are carried across the swap. They are
--    read before the delete, keyed by (item id, lower(venmo_username)) — the
--    same key 0016's unique index puts on participants and the same key 0021
--    and 0022 read provenance by — and re-inserted after the new rows land, on
--    conflict do nothing so the payload's own version of a claim wins. A claim
--    whose item the owner deleted has nothing to point at and is dropped.
--
-- 3. Charges the payload does not restate are carried across the same way,
--    re-pointed at the participant's new row. Without this the claimer's
--    charge dies with her old row id even though the claim survives.
--
-- Parts 2 and 3 only apply while the receipt is out for claiming
-- (status <> 'open'), which is the only state in which a claim can be made:
-- toggleClaim and joinReceipt both refuse unless status = 'shared', and the
-- owner's editor only renders for a receipt that is 'open'
-- (src/app/receipts/[id]/page.tsx). While the receipt is 'open' nothing can
-- have been claimed behind the owner's back, so the payload stays fully
-- authoritative and an assignment it drops is one the owner removed. This is
-- the same reading of `status` that 0022 uses to tell "the owner removed them"
-- apart from "the payload never saw them", and it is why "Reopen editing" still
-- lets the owner take a claim off the tab.
--
-- ── what is deliberately not changed ───────────────────────────────────────
--
-- While claiming is under way the owner's page is a stale one, so it cannot
-- revoke a claimer's claim: restored claims are unioned with the payload's,
-- not diffed against them. Reopening editing hands that control back. The
-- 0022 refusal still fires, unchanged, for a claimer the payload does not
-- name; a save that names everyone no longer needs one.
--
-- Additive only: a function body replacement and nothing else. No table,
-- column, index, grant or row is added, dropped or rewritten. Atomicity is
-- untouched — same one function call, same one transaction, no transaction
-- control statements, and the delete/re-insert still lands whole or not at all.

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
  v_status text;
  v_claiming boolean;
  v_known jsonb;
  v_charged jsonb;
  v_live_items jsonb;
  v_items jsonb;
  v_participants jsonb;
  v_item_ids jsonb;
  v_participant_ids jsonb;
  v_prior jsonb;
  v_claims jsonb;
  v_carried_charges jsonb;
begin
  if auth.uid() is null then
    raise exception 'save_receipt_state: not signed in' using errcode = '42501';
  end if;

  select created_by, status into v_owner, v_status
  from receipts where id = p_receipt_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'save_receipt_state: caller does not own this receipt'
      using errcode = '42501';
  end if;

  -- The receipt has been out for claiming since this client's snapshot could
  -- have been taken, so a participant the payload does not name may be someone
  -- it never saw rather than someone the owner removed, and a claim it does not
  -- name may be one made since rather than one the owner took off. Read before
  -- the update at the bottom of this function, which is free to move the status
  -- on.
  v_claiming := v_status is distinct from 'open';

  -- The usernames the payload names, keyed the way 0016's unique index keys the
  -- table: lower(venmo_username).
  select coalesce(jsonb_object_agg(lower(p.venmo_username), true), '{}'::jsonb)
    into v_known
  from jsonb_to_recordset(coalesce(p_participants, '[]'::jsonb))
    as p(venmo_username text);

  -- The usernames this payload writes a charge for, keyed the same way. A
  -- charge the payload restates is replaced by it; one it says nothing about is
  -- carried across rather than dropped.
  select coalesce(jsonb_object_agg(lower(p.venmo_username), true), '{}'::jsonb)
    into v_charged
  from jsonb_to_recordset(coalesce(p_charges, '[]'::jsonb))
    as c(participant_client_id text)
  join jsonb_to_recordset(coalesce(p_participants, '[]'::jsonb))
    as p(client_id text, venmo_username text)
    on p.client_id = c.participant_client_id;

  -- Everything the delete below is about to destroy that the payload cannot
  -- replace, keyed the same way. Read here, written back on the insert, both
  -- inside this one call.
  --
  -- coalesce(joined_at, created_at) backfills rows that predate 0021 lazily,
  -- with their real creation time rather than now(), so an owner save cannot
  -- make an old participant look like a new joiner.
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

  -- The claims made through the share link, read before the deletes take them.
  -- Keyed by the item's id — which the payload can now keep — and the claimer's
  -- username, because her row id does not survive the participant swap.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'item_id', ia.receipt_item_id,
               'username', lower(rp.venmo_username),
               'quantity_assigned', ia.quantity_assigned
             )
           ),
           '[]'::jsonb
         )
    into v_claims
  from item_assignments ia
  join receipt_items ri on ri.id = ia.receipt_item_id
  join receipt_participants rp on rp.id = ia.participant_id
  where ri.receipt_id = p_receipt_id
    and v_claiming
    and rp.joined_via_share;

  -- And the charges this payload does not restate, for the same reason: the
  -- row they point at is about to be re-minted. Rows the delete below leaves
  -- alone are excluded — they keep the charge they already have.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'username', lower(rp.venmo_username),
               'from_user_id', c.from_user_id,
               'amount', c.amount,
               'venmo_link', c.venmo_link,
               'paid_at', c.paid_at
             )
           ),
           '[]'::jsonb
         )
    into v_carried_charges
  from charges c
  join receipt_participants rp on rp.id = c.to_participant_id
  where c.receipt_id = p_receipt_id
    and v_claiming
    and not (v_charged ? lower(rp.venmo_username))
    and not (rp.joined_via_share and not (v_known ? lower(rp.venmo_username)));

  -- The ids the payload is allowed to keep: the rows that are on this receipt
  -- right now. Anything else in an item's `id` is ignored and a fresh id
  -- minted, so a payload cannot name a row on somebody else's tab.
  select coalesce(jsonb_object_agg(ri.id::text, true), '{}'::jsonb)
    into v_live_items
  from receipt_items ri
  where ri.receipt_id = p_receipt_id;

  -- Mint the new ids before touching anything, so the inserts below can be
  -- written straight from these arrays. An item that names a live row keeps
  -- that row's id, which is what lets a claim on it survive the swap; the
  -- row_number guard keeps a payload that names the same id twice from
  -- colliding on the primary key.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', x.id,
               'client_id', x.client_id,
               'name', x.name,
               'price', x.price,
               'quantity', coalesce(x.quantity, 1),
               'sort_order', coalesce(x.sort_order, 0)
             )
             order by coalesce(x.sort_order, 0)
           ),
           '[]'::jsonb
         )
    into v_items
  from (
    select i.client_id, i.name, i.price, i.quantity, i.sort_order,
           case
             when i.id is not null
              and v_live_items ? i.id::text
              and row_number() over (
                    partition by i.id
                    order by coalesce(i.sort_order, 0), i.client_id
                  ) = 1
             then i.id
             else gen_random_uuid()
           end as id
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as i(client_id text, id uuid, name text, price numeric,
           quantity int, sort_order int)
  ) x;

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

  -- Out with the old, except the people this payload never saw. Participants
  -- cascade to charges and item_assignments, items cascade to item_assignments;
  -- charges are cleared explicitly so a save that produces none leaves none
  -- behind — but not the charges of someone we are deliberately not touching.
  delete from charges c
  where c.receipt_id = p_receipt_id
    and not exists (
      select 1 from receipt_participants rp
      where rp.id = c.to_participant_id
        and v_claiming
        and rp.joined_via_share
        and not (v_known ? lower(rp.venmo_username))
    );

  delete from receipt_participants rp
  where rp.receipt_id = p_receipt_id
    and not (
      v_claiming
      and rp.joined_via_share
      and not (v_known ? lower(rp.venmo_username))
    );

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

  -- Anyone left that this payload does not name came in through the share link
  -- after the browser took its snapshot. Applying a list that old would drop
  -- them, so nothing is applied: this raises, and the whole call — the deletes
  -- above included — rolls back with the tab exactly as it was. Checked here,
  -- after the swap, so a join that commits while these statements run is caught
  -- too; the delete above is what leaves it there to be found.
  if exists (
    select 1 from receipt_participants rp
    where rp.receipt_id = p_receipt_id
      and v_claiming
      and rp.joined_via_share
      and not (v_known ? lower(rp.venmo_username))
  ) then
    raise exception
      'save_receipt_state: a participant joined since this client loaded the receipt'
      using errcode = 'PT409';
  end if;

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

  -- Back go the claims the swap would otherwise have taken: the item is there
  -- because the payload kept its id, the claimer is there under the same
  -- username with a new row id. An item the owner deleted is not re-created for
  -- a claim to point at, so that claim goes with it — which is the whole reason
  -- this is a re-insert rather than a refusal to delete.
  insert into item_assignments (receipt_item_id, participant_id, quantity_assigned)
  select k.item_id, rp.id, coalesce(k.quantity_assigned, 1)
  from jsonb_to_recordset(v_claims)
    as k(item_id uuid, username text, quantity_assigned int)
  join receipt_participants rp
    on rp.receipt_id = p_receipt_id
   and lower(rp.venmo_username) = k.username
  where exists (
    select 1 from receipt_items ri
    where ri.id = k.item_id and ri.receipt_id = p_receipt_id
  )
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

  -- And the charges this payload never spoke about, re-pointed at the row the
  -- swap just minted for the same person. Nothing here can duplicate a charge
  -- written above: those are exactly the people v_charged names, and this list
  -- excludes them.
  insert into charges
    (receipt_id, from_user_id, to_participant_id, amount, venmo_link, paid_at)
  select p_receipt_id, coalesce(k.from_user_id, v_owner), rp.id,
         k.amount, k.venmo_link, k.paid_at
  from jsonb_to_recordset(v_carried_charges)
    as k(username text, from_user_id uuid, amount numeric,
         venmo_link text, paid_at timestamptz)
  join receipt_participants rp
    on rp.receipt_id = p_receipt_id
   and lower(rp.venmo_username) = k.username;

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
-- and these are the same ones 0016 set and 0021 and 0022 restated.
revoke execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated, service_role;
