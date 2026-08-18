-- One participant per Venmo username per receipt, and an atomic receipt save.
--
-- Two problems, one migration:
--
-- 1. `receipt_participants` had no unique key, so two people opening the share
--    link at the same moment with the same Venmo username both got a row — and
--    then both got charged. The join path in `joinReceipt` reads before it
--    inserts, which does not survive concurrency; the index does.
--
-- 2. The new-receipt and share flows saved by deleting every item and
--    participant from the browser and re-inserting them over several round
--    trips. A dropped connection between the delete and the insert wiped the
--    tab. `save_receipt_state` does the whole swap inside one function call,
--    so it is one transaction: it either lands or nothing changed.
--
-- Additive only: no table, column, or row is dropped.

-- ── one participant per (receipt, venmo username) ────────────────────────────
-- Case-insensitive, because the same person types "Alice" on one phone and
-- "alice" on another. Existing duplicates will block this index, so the owner
-- must check for them BEFORE applying. Never run by an agent.
--
--   -- duplicates, worst first:
--   -- select receipt_id, lower(venmo_username) as username,
--   --        count(*) as rows, array_agg(id order by id) as participant_ids
--   --   from public.receipt_participants
--   --  group by receipt_id, lower(venmo_username)
--   -- having count(*) > 1
--   --  order by rows desc;
--   --
--   -- If it returns rows, merge each group by hand: move item_assignments and
--   -- charges onto the surviving id, then delete the losers. Deleting a
--   -- participant cascades their claims, so re-point before deleting.

create unique index if not exists receipt_participants_receipt_username_key
  on public.receipt_participants (receipt_id, lower(venmo_username));

-- ── atomic save ──────────────────────────────────────────────────────────────
-- Replaces the browser's delete-then-reinsert. The caller sends the whole new
-- state; this deletes the old rows and writes the new ones in one transaction.
--
-- Ids are minted here rather than by the table default so assignments and
-- charges can reference the new rows by the client ids the browser already
-- holds, without a second round trip to read the inserted ids back.
--
-- security definer to bypass RLS on the four child tables; the caller is
-- checked against receipts.created_by first, so it only ever rewrites a
-- receipt the signed-in user owns. Callable with a user session — the service
-- role has no auth.uid() and is rejected by the same check.
--
-- Payload shapes:
--   p_items         [{client_id, name, price, quantity, sort_order}]
--   p_participants  [{client_id, user_id, venmo_username, display_name, is_owner}]
--   p_assignments   [{item_client_id, participant_client_id}]
--   p_charges       [{participant_client_id, amount, venmo_link, paid_at}]
--   p_receipt       {status, split_mode, merchant_name, subtotal, tax, tip, total}
--                   — only the keys present are written, so a caller that does
--                   not own the status (the share flow) leaves it alone.

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
begin
  if auth.uid() is null then
    raise exception 'save_receipt_state: not signed in' using errcode = '42501';
  end if;

  select created_by into v_owner from receipts where id = p_receipt_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'save_receipt_state: caller does not own this receipt'
      using errcode = '42501';
  end if;

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

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', gen_random_uuid(),
               'client_id', p.client_id,
               'user_id', p.user_id,
               'venmo_username', p.venmo_username,
               'display_name', p.display_name,
               'is_owner', coalesce(p.is_owner, false)
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
    (id, receipt_id, user_id, venmo_username, display_name, is_owner)
  select r.id, p_receipt_id, r.user_id, r.venmo_username, r.display_name, r.is_owner
  from jsonb_to_recordset(v_participants)
    as r(id uuid, user_id uuid, venmo_username text,
         display_name text, is_owner boolean);

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

revoke execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function
  public.save_receipt_state(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
  to authenticated, service_role;
