create table public.charges (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null references public.receipts(id) on delete cascade,
  from_user_id     uuid not null references public.profiles(id),
  to_participant_id uuid not null references public.receipt_participants(id) on delete cascade,
  amount           numeric(10,2) not null,
  venmo_link       text,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);
