-- Support anonymous (guest) sign-ins. Anonymous auth.users have no email, so the
-- new-user trigger must not assume one: coalesce to a 'Guest' display name and an
-- empty email (profiles.email stays NOT NULL). Normal email signups are unaffected.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Guest'),
    coalesce(new.email, '')
  );
  return new;
end;
$$;
