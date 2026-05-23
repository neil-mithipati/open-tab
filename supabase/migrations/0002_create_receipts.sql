create table public.receipts (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null references public.profiles(id) on delete cascade,
  image_url       text,
  merchant_name   text,
  date_of_receipt date,
  subtotal        numeric(10,2),
  tax             numeric(10,2),
  tip             numeric(10,2),
  total           numeric(10,2),
  notes           text,
  split_mode      text check (split_mode in ('equal', 'by_item')) default 'equal',
  status          text check (status in ('draft', 'reviewing', 'charging', 'settled')) default 'draft',
  created_at      timestamptz not null default now()
);
