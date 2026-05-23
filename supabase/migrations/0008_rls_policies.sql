-- profiles: public read for participant search; owner manages own row
alter table public.profiles enable row level security;

create policy "profiles_select_all" on public.profiles
  for select using (true);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- receipts: creator full access; participants can read
alter table public.receipts enable row level security;

create policy "receipts_all_creator" on public.receipts
  for all using (auth.uid() = created_by);

create policy "receipts_select_participant" on public.receipts
  for select using (
    exists (
      select 1 from public.receipt_participants rp
      where rp.receipt_id = id and rp.user_id = auth.uid()
    )
  );

-- receipt_items: access via receipt
alter table public.receipt_items enable row level security;

create policy "receipt_items_access" on public.receipt_items
  for all using (
    exists (
      select 1 from public.receipts r
      where r.id = receipt_id and (
        r.created_by = auth.uid() or
        exists (
          select 1 from public.receipt_participants rp
          where rp.receipt_id = r.id and rp.user_id = auth.uid()
        )
      )
    )
  );

-- receipt_participants: access via receipt
alter table public.receipt_participants enable row level security;

create policy "receipt_participants_access" on public.receipt_participants
  for all using (
    exists (
      select 1 from public.receipts r
      where r.id = receipt_id and (
        r.created_by = auth.uid() or
        exists (
          select 1 from public.receipt_participants rp2
          where rp2.receipt_id = r.id and rp2.user_id = auth.uid()
        )
      )
    )
  );

-- item_assignments: access via receipt_items → receipts
alter table public.item_assignments enable row level security;

create policy "item_assignments_access" on public.item_assignments
  for all using (
    exists (
      select 1 from public.receipt_items ri
      join public.receipts r on r.id = ri.receipt_id
      where ri.id = receipt_item_id and (
        r.created_by = auth.uid() or
        exists (
          select 1 from public.receipt_participants rp
          where rp.receipt_id = r.id and rp.user_id = auth.uid()
        )
      )
    )
  );

-- friendships: users manage their own rows; can read own friendships
alter table public.friendships enable row level security;

create policy "friendships_select_own" on public.friendships
  for select using (auth.uid() = user_id);

create policy "friendships_insert_own" on public.friendships
  for insert with check (auth.uid() = user_id);

create policy "friendships_delete_own" on public.friendships
  for delete using (auth.uid() = user_id);

-- charges: creator full access; participant linked user can read
alter table public.charges enable row level security;

create policy "charges_all_creator" on public.charges
  for all using (auth.uid() = from_user_id);

create policy "charges_select_participant" on public.charges
  for select using (
    exists (
      select 1 from public.receipt_participants rp
      where rp.id = to_participant_id and rp.user_id = auth.uid()
    )
  );
