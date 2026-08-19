-- receipt_participants had no created_at column, so the claim-join rate
-- limiter (OT-107) has nothing to count recent rows by. Additive only: no
-- table, column, or row is dropped. Existing rows backfill to now() on
-- creation of the column, which is fine — the limiter only cares about rows
-- inserted after this ships.

alter table public.receipt_participants
  add column if not exists created_at timestamptz not null default now();
