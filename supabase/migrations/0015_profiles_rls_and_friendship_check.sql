-- Stop publishing every profile, and check the caller in add_friendship.
--
-- 0008 shipped `profiles_select_all ... using (true)`, so anyone holding the
-- anon key could read every user's email, venmo_username and invite_token.
-- Profiles are now readable only by their owner. The three legitimate
-- cross-user reads move to security definer functions that return
-- id / display_name / venmo_username and nothing else — never email, and never
-- an invite_token (the token function only resolves a token the caller already
-- holds).
--
-- 0006 shipped add_friendship as security definer with no caller check, so any
-- user could force a friendship between two arbitrary accounts. It now refuses
-- unless the caller is one of the two.
--
-- Additive only: no table, column, or row is dropped.

-- ── profiles: own row only ───────────────────────────────────────────────────

drop policy if exists "profiles_select_all" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- ── invite links ─────────────────────────────────────────────────────────────
-- /invite/[token] renders for logged-out visitors ("Sign in to connect"), so
-- anon needs execute here. The caller must already hold the unguessable token;
-- a wrong token returns zero rows.

create or replace function public.get_profile_by_invite_token(token text)
returns table (id uuid, display_name text, venmo_username text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.venmo_username
  from public.profiles p
  where p.invite_token = token
$$;

revoke execute on function public.get_profile_by_invite_token(text) from public;
grant execute on function public.get_profile_by_invite_token(text)
  to anon, authenticated, service_role;

-- ── friend search by Venmo username ──────────────────────────────────────────
-- Exact, case-insensitive match only (no prefix scan), so this cannot be walked
-- to enumerate the user table. Self is excluded server-side rather than by a
-- client-supplied id.

create or replace function public.find_profile_by_venmo_username(username text)
returns table (id uuid, display_name text, venmo_username text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.venmo_username
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and lower(p.venmo_username) = lower(trim(username))
$$;

revoke execute on function public.find_profile_by_venmo_username(text) from public;
grant execute on function public.find_profile_by_venmo_username(text)
  to authenticated, service_role;

-- ── the caller's own friend list ─────────────────────────────────────────────
-- Replaces the browser-side friendships → profiles embed, which relied on
-- profiles being world-readable.

create or replace function public.list_friend_profiles()
returns table (id uuid, display_name text, venmo_username text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.venmo_username
  from public.friendships f
  join public.profiles p on p.id = f.friend_id
  where auth.uid() is not null
    and f.user_id = auth.uid()
$$;

revoke execute on function public.list_friend_profiles() from public;
grant execute on function public.list_friend_profiles()
  to authenticated, service_role;

-- ── add_friendship: caller must be one of the two users ──────────────────────
-- Same signature and same bidirectional insert as 0006; only the guard is new.

create or replace function public.add_friendship(a uuid, b uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or (auth.uid() <> a and auth.uid() <> b) then
    raise exception 'add_friendship: caller must be one of the two users'
      using errcode = '42501';
  end if;

  insert into public.friendships (user_id, friend_id) values (a, b) on conflict do nothing;
  insert into public.friendships (user_id, friend_id) values (b, a) on conflict do nothing;
end;
$$;

revoke execute on function public.add_friendship(uuid, uuid) from public;
grant execute on function public.add_friendship(uuid, uuid)
  to authenticated, service_role;
