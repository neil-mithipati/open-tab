create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null,
  email          text not null,
  venmo_username text,
  invite_token   text unique not null default gen_random_uuid()::text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- auto-create profile skeleton on signup; venmo_username filled during onboarding
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    split_part(new.email, '@', 1),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();
