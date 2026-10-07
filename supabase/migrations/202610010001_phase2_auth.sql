create type public.degree_level as enum ('diploma', 'btech', 'mtech');
create type public.app_role as enum ('student', 'committee', 'admin');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text,
  department_id uuid references public.departments(id) on delete set null,
  degree public.degree_level,
  year integer,
  roll_number text,
  bio text,
  avatar_url text,
  role public.app_role not null default 'student',
  visible_in_directory boolean not null default true,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_year_check check (year is null or year between 1 and 4)
);

create unique index profiles_username_lower_idx on public.profiles (lower(username)) where username is not null;

create or replace function public.is_allowed_college_email(email text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  domain_part text;
begin
  if email is null or email <> btrim(email) or email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    return false;
  end if;

  domain_part := lower(split_part(email, '@', 2));
  return domain_part = 'vjti.ac.in' or domain_part like '%.vjti.ac.in';
end;
$$;

create or replace function public.enforce_college_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_allowed_college_email(new.email) then
    raise exception 'Only verified VJTI college email addresses are allowed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_college_email on auth.users;
create trigger enforce_college_email
  before insert on auth.users
  for each row execute function public.enforce_college_email();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.current_user_is_admin() then
    if new.role is distinct from old.role or (old.onboarded and new.onboarded is distinct from old.onboarded) then
      raise exception 'Role and completed onboarding status can only be changed by an administrator.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.is_username_available(candidate text, current_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(candidate)
      and id <> coalesce(current_user_id, auth.uid())
  );
$$;

grant execute on function public.is_allowed_college_email(text) to anon, authenticated;
grant execute on function public.is_username_available(text, uuid) to authenticated;

alter table public.departments enable row level security;
alter table public.profiles enable row level security;

create policy "authenticated users can read departments"
  on public.departments for select to authenticated using (true);
create policy "admins can manage departments"
  on public.departments for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "college users can read visible profiles"
  on public.profiles for select to authenticated using (visible_in_directory or id = auth.uid());
create policy "college users can update their profile"
  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admins can manage profiles"
  on public.profiles for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "authenticated users can read avatars"
  on storage.objects for select to authenticated using (bucket_id = 'avatars');
create policy "users can upload their avatar"
  on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users can update their avatar"
  on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users can delete their avatar"
  on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);