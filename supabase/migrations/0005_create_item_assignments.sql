create table public.item_assignments (
  id                uuid primary key default gen_random_uuid(),
  receipt_item_id   uuid not null references public.receipt_items(id) on delete cascade,
  participant_id    uuid not null references public.receipt_participants(id) on delete cascade,
  quantity_assigned int not null default 1,
  unique (receipt_item_id, participant_id)
);
