create table public.friendships (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, friend_id),
  check (user_id <> friend_id)
);

-- helper to add bidirectional friendship in one call
create or replace function public.add_friendship(a uuid, b uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.friendships (user_id, friend_id) values (a, b) on conflict do nothing;
  insert into public.friendships (user_id, friend_id) values (b, a) on conflict do nothing;
end;
$$;
