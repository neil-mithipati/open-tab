-- Stop an owner's save from deleting people it never saw.
--
-- The defect, pre-existing since 0016: save_receipt_state deletes every
-- participant on the receipt and re-inserts whatever list the browser holds.
-- That list is a snapshot, taken when the owner's editor rendered. Anyone who
-- came in through the share link after that moment is missing from it, so the
-- swap removes them outright — their row, and by cascade their claims and
-- their charges. The window stays open for as long as the owner has the page
-- in front of them, which on a 25-person dinner is exactly when people are
-- joining. It is a lost update, and what the user sees is a person silently
-- vanishing from the tab.
--
-- 0021 fixed the neighbouring bug (a save erasing joined_via_share/joined_at)
-- and is left exactly as it stands; everything it established is carried
-- through here unchanged.
--
-- ── the fix, in two interlocking parts ──────────────────────────────────────
--
-- 1. The participant delete stops being unconditional. It now skips rows the
--    payload cannot possibly know about — share-link joiners whose username is
--    absent from the payload, on a receipt that has left the editing state.
--    The charge delete skips those people's charges for the same reason. So
--    even in the narrow race (someone commits their join between our statements
--    and our commit) the swap cannot take a person with it.
--
-- 2. The save then refuses rather than half-applying. After the participant
--    swap, if any such unseen joiner is still there, the function raises and
--    the whole call rolls back — no items, no participants, no charges, no
--    receipt columns written. The owner is told to reload; losing one save is
--    far better than losing a person, and a rollback keeps that person's claims
--    and charges intact too, which a merge could not: item rows are re-minted
--    on every save, so a claim made after the snapshot dies with the item id it
--    points at no matter how carefully the participant row is preserved.
--
-- Part 1 is what makes part 2 possible: the check has to run after the delete
-- to see joins that landed while we were working, and it can only see them if
-- the delete left them alone.
--
-- ── why "absent from the payload" is safe to read as "we removed them" when
--    the receipt is open, and not otherwise ────────────────────────────────
--
-- An owner who deletes a participant sends a payload without them, which looks
-- identical to a payload that predates someone's join. The status column tells
-- the two apart:
--
--   * A share-link join is only accepted while status = 'shared'
--     (joinReceipt in src/app/actions/claim.ts refuses otherwise), and
--   * the owner's editor is only rendered for a receipt that is not out for
--     claiming (src/app/receipts/[id]/page.tsx sends 'shared' and 'closed'
--     receipts to ClaimOwnerView, which has no participant editing and does
--     not call this function).
--
-- So a client's snapshot is always taken while the receipt is 'open'. If it is
-- still 'open' at save time, nobody can have joined since — absence means the
-- owner removed them, and they are deleted, which is what "Reopen editing" then
-- removing a claimer relies on. Once the receipt has gone out for claiming, a
-- missing share-joiner may be someone the snapshot never contained, and the
-- save gives way to them.
--
-- Not covered, so nobody assumes it is: a claim made after the snapshot by
-- someone who IS in the payload still dies in the swap, because the item rows
-- are re-minted. That is the same family and wants the same treatment, but it
-- needs stable item identity in the payload, which the callers do not send yet.
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
  v_items jsonb;
  v_participants jsonb;
  v_item_ids jsonb;
  v_participant_ids jsonb;
  v_prior jsonb;
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
  -- it never saw rather than someone the owner removed. Read before the update
  -- at the bottom of this function, which is free to move the status on.
  v_claiming := v_status is distinct from 'open';

  -- The usernames the payload names, keyed the way 0016's unique index keys the
  -- table: lower(venmo_username).
  select coalesce(jsonb_object_agg(lower(p.venmo_username), true), '{}'::jsonb)
    into v_known
  from jsonb_to_recordset(coalesce(p_participants, '[]'::jsonb))
    as p(venmo_username text);

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
-- and these are the same ones 0016 set and 0021 restated.
revoke execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated, service_role;
