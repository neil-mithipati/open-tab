-- Named, reusable sets of people ("roommates", "poker night") that expand into
-- individual participants when splitting a check. Members are a snapshot of
-- Venmo usernames rather than foreign keys: a "friend" is either a profile or
-- an external contact, so no single foreign key fits, and removing someone from
-- the friends list should not silently shrink a group. Nothing about a group is
-- ever stored on a receipt — the split UI expands it at selection time into
-- ordinary participants, so every member is charged individually.

create table public.friend_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.friend_group_members (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.friend_groups(id) on delete cascade,
  venmo_username text not null,
  display_name   text,
  created_at     timestamptz not null default now(),
  unique (group_id, venmo_username)
);

alter table public.friend_groups enable row level security;

create policy "friend_groups_select_own" on public.friend_groups
  for select using (auth.uid() = user_id);

create policy "friend_groups_insert_own" on public.friend_groups
  for insert with check (auth.uid() = user_id);

create policy "friend_groups_update_own" on public.friend_groups
  for update using (auth.uid() = user_id);

create policy "friend_groups_delete_own" on public.friend_groups
  for delete using (auth.uid() = user_id);

-- Members inherit access from the group that owns them, the same way
-- item_assignments inherits from its receipt. friend_groups' own policies never
-- read this table, so the subquery cannot recurse.
alter table public.friend_group_members enable row level security;

create policy "friend_group_members_access" on public.friend_group_members
  for all using (
    exists (
      select 1 from public.friend_groups g
      where g.id = group_id and g.user_id = auth.uid()
    )
  );
