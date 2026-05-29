-- Fix: infinite recursion between receipts ↔ receipt_participants RLS policies.
--
-- receipts_select_participant queries receipt_participants (triggers its policy),
-- which queries receipts (triggers receipts_select_participant) → infinite loop.
--
-- Solution: security definer helper functions bypass RLS entirely, so neither
-- policy re-enters the other's evaluation chain.

create or replace function public.receipt_creator_id(r_id uuid)
returns uuid language sql security definer set search_path = public as $$
  select created_by from public.receipts where id = r_id
$$;

create or replace function public.is_receipt_participant(r_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.receipt_participants
    where receipt_id = r_id and user_id = auth.uid()
  )
$$;

-- receipts: use security definer fn so the receipt_participants query
-- bypasses RLS and cannot re-trigger receipts_select_participant
drop policy if exists "receipts_select_participant" on public.receipts;
create policy "receipts_select_participant" on public.receipts
  for select using (public.is_receipt_participant(id));

-- receipt_participants: use security definer fn for the receipts ownership
-- check; direct column comparison for self-participation (no subquery)
drop policy if exists "receipt_participants_access" on public.receipt_participants;
create policy "receipt_participants_access" on public.receipt_participants
  for all using (
    public.receipt_creator_id(receipt_id) = auth.uid()
    or user_id = auth.uid()
  );
