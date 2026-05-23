create table public.receipt_participants (
  id             uuid primary key default gen_random_uuid(),
  receipt_id     uuid not null references public.receipts(id) on delete cascade,
  user_id        uuid references public.profiles(id),   -- null for manual Venmo entries
  venmo_username text not null,
  display_name   text not null,
  is_owner       boolean not null default false
);
