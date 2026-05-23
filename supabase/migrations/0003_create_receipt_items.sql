create table public.receipt_items (
  id         uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  name       text not null,
  price      numeric(10,2) not null,
  quantity   int not null default 1,
  sort_order int not null default 0
);
