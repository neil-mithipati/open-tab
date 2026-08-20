-- Stop an owner's save from erasing a claimer's "done".
--
-- The defect, pre-existing since 0016 and left alone by 0021, 0022 and 0023:
-- save_receipt_state re-inserts receipt_participants without listing
-- claim_done_at, so the column comes back at its 0011 default of null — which
-- 0011 defines as "still claiming". A friend taps Done, the owner corrects one
-- price, and the owner's own view (ClaimOwnerView.tsx) puts her back in the
-- still-claiming list. The owner then waits on a person who has finished, or
-- closes claiming assuming she has not.
--
-- It is the same shape as the bug 0021 fixed for joined_via_share and
-- joined_at, and 0021's header named it explicitly as still outstanding: the
-- delete-and-re-insert drops a column that records the claimer's own actions
-- rather than anything the owner's payload states. So it is fixed the same
-- way. claim_done_at is read into v_prior before the delete, keyed on
-- lower(venmo_username) exactly as 0016's unique index keys the table, and
-- written back on the insert — in the same statement sequence, inside the same
-- one function call.
--
-- ── the backfill, and the trap OT-124 found ────────────────────────────────
--
-- Existing rows are not written at all. There is no DDL in this migration:
-- claim_done_at has been on the table since 0011, and every row already holds
-- the truth about whether that person tapped Done. A restore has nothing to
-- backfill, so the honest thing is to add no update, no default and no column.
--
-- Saying that explicitly because the tempting version of this change is the one
-- 0021 nearly shipped and caught: `add column ... default now()` writes now()
-- into every existing row. On joined_at that would have made 20 old
-- participants read as 20 joins in the last hour and locked a live share link
-- the day it deployed — the fix recreating the bug it exists to remove. The
-- same shape here would be worse, not better: any now() on claim_done_at, in
-- DDL or in a coalesce on the carry-forward below, would mark every
-- participant as having finished at deploy time, including the ones still
-- choosing items. That is this very defect inverted, and it is the dangerous
-- direction.
--
-- Null is the value that means "we do not know that she finished", and it is
-- the safe way to be wrong. An owner who sees someone as still claiming waits;
-- an owner who sees someone as done closes the tab and charges her for what she
-- had picked so far. So the carry-forward below uses no coalesce: a username
-- v_prior does not know about gets null, and only a real stored timestamp
-- produces a done claimer. The claimer's own toggle (setClaimDone) remains the
-- only thing that writes the column.
--
-- ── what is deliberately not gated ─────────────────────────────────────────
--
-- The carry is unconditional, not gated on v_claiming the way 0023 gates the
-- claim and charge restores. Those two restore rows the payload also states,
-- so there is a conflict to resolve and `status` decides it. Nothing in the
-- payload mentions claim_done_at — saveReceipt.ts has no field for it — so an
-- owner save can express no intent about it in any status and there is nothing
-- to diff against. This matches how 0021 carries joined_via_share and
-- joined_at, which are unconditional for the same reason.
--
-- One consequence, stated rather than discovered later: after "Reopen editing"
-- and a re-share, someone who tapped Done in the earlier round still reads as
-- done until she taps it again. Before this migration the owner's next save
-- happened to clear it. That clearing was a side effect of the bug, not a
-- decision, and it took the true stamps with the stale ones; the claimer can
-- still un-done herself from her own page.
--
-- Additive only: a function body replacement and nothing else. No table,
-- column, index, grant or row is added, dropped or rewritten. 0022's PT409
-- refusal and 0023's item id re-use, claim restore and carried charges are
-- carried through verbatim. Atomicity is untouched — one function call, one
-- transaction, no transaction control statements, and the delete/re-insert
-- still lands whole or not at all.

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
  --
  -- claim_done_at is read raw and put back raw. It is the claimer's own record
  -- of tapping "done" (0011), never anything the owner's payload states, so
  -- there is nothing to coalesce it against and no default to fall back on: a
  -- null stays null.
  select coalesce(
           jsonb_object_agg(
             lower(rp.venmo_username),
             jsonb_build_object(
               'joined_via_share', rp.joined_via_share,
               'joined_at', coalesce(rp.joined_at, rp.created_at),
               'claim_done_at', rp.claim_done_at
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

  -- A username already on this receipt keeps its provenance, its join time and
  -- its claim-done stamp; one the payload introduces is new, so it did not join
  -- via the share link, it joins now, and it has not finished claiming.
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
                 ),
               -- No coalesce, deliberately: someone this receipt has not seen
               -- before has not tapped "done", and now() here would say she
               -- had. See the header.
               'claim_done_at',
                 (v_prior -> lower(p.venmo_username) ->> 'claim_done_at')::timestamptz
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
     joined_via_share, joined_at, claim_done_at)
  select r.id, p_receipt_id, r.user_id, r.venmo_username, r.display_name,
         r.is_owner, r.joined_via_share, r.joined_at, r.claim_done_at
  from jsonb_to_recordset(v_participants)
    as r(id uuid, user_id uuid, venmo_username text, display_name text,
         is_owner boolean, joined_via_share boolean, joined_at timestamptz,
         claim_done_at timestamptz);

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
-- and these are the same ones 0016 set and 0021, 0022 and 0023 restated.
revoke execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated, service_role;
