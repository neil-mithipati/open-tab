create table public.external_contacts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  venmo_username text not null,
  display_name   text,
  created_at     timestamptz not null default now(),
  unique (user_id, venmo_username)
);

alter table public.external_contacts enable row level security;

create policy "external_contacts_select_own" on public.external_contacts
  for select using (auth.uid() = user_id);

create policy "external_contacts_insert_own" on public.external_contacts
  for insert with check (auth.uid() = user_id);

create policy "external_contacts_delete_own" on public.external_contacts
  for delete using (auth.uid() = user_id);
