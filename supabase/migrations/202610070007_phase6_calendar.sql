do $$ begin
  create type public.holiday_kind as enum ('institute', 'national', 'exam_break');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.announcement_tag as enum ('general', 'academic', 'exam', 'event', 'placement', 'urgent');
exception when duplicate_object then null;
end $$;

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  name text not null,
  kind public.holiday_kind not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  unique (date, name)
);
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  location text,
  poi_id uuid references public.pois(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  organiser text not null default '',
  created_by uuid not null references public.profiles(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  constraint events_valid_range check (ends_at >= starts_at)
);
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  tag public.announcement_tag not null default 'general',
  pinned boolean not null default false,
  department_id uuid references public.departments(id) on delete set null,
  author_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  attachment_path text
);
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists events_starts_at_idx on public.events(starts_at);
create index if not exists holidays_date_idx on public.holidays(date);
create index if not exists announcements_feed_idx on public.announcements(pinned desc, created_at desc);
create index if not exists announcements_department_idx on public.announcements(department_id);

create or replace function public.current_user_is_committee_or_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('committee', 'admin')); $$;

create or replace function public.protect_calendar_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'events' and old.created_by <> auth.uid() and not public.current_user_is_admin() then
    raise exception 'Only the event organiser or an administrator can edit this item.' using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'announcements' and old.author_id <> auth.uid() and not public.current_user_is_admin() then
    raise exception 'Only the announcement author or an administrator can edit this item.' using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'events' then new.created_by := old.created_by; else new.author_id := old.author_id; end if;
  return new;
end;
$$;
drop trigger if exists protect_event_owner on public.events;
create trigger protect_event_owner before update on public.events for each row execute function public.protect_calendar_owner();
drop trigger if exists protect_announcement_owner on public.announcements;
create trigger protect_announcement_owner before update on public.announcements for each row execute function public.protect_calendar_owner();

alter table public.holidays enable row level security;
alter table public.events enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

drop policy if exists "authenticated users can read holidays" on public.holidays;
create policy "authenticated users can read holidays" on public.holidays for select to authenticated using (true);
drop policy if exists "admins can manage holidays" on public.holidays;
create policy "admins can manage holidays" on public.holidays for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

drop policy if exists "authenticated users can read events" on public.events;
create policy "authenticated users can read events" on public.events for select to authenticated using (true);
drop policy if exists "committee can create events" on public.events;
create policy "committee can create events" on public.events for insert to authenticated
  with check (public.current_user_is_committee_or_admin() and created_by = auth.uid());
drop policy if exists "authors and admins can update events" on public.events;
create policy "authors and admins can update events" on public.events for update to authenticated
  using (created_by = auth.uid() or public.current_user_is_admin())
  with check (created_by = auth.uid() or public.current_user_is_admin());
drop policy if exists "authors and admins can delete events" on public.events;
create policy "authors and admins can delete events" on public.events for delete to authenticated
  using (created_by = auth.uid() or public.current_user_is_admin());

drop policy if exists "users can read scoped announcements" on public.announcements;
create policy "users can read scoped announcements" on public.announcements for select to authenticated
  using (department_id is null or department_id = (select department_id from public.profiles where id = auth.uid()));
drop policy if exists "committee can create announcements" on public.announcements;
create policy "committee can create announcements" on public.announcements for insert to authenticated
  with check (public.current_user_is_committee_or_admin() and author_id = auth.uid());
drop policy if exists "authors and admins can update announcements" on public.announcements;
create policy "authors and admins can update announcements" on public.announcements for update to authenticated
  using (author_id = auth.uid() or public.current_user_is_admin())
  with check (author_id = auth.uid() or public.current_user_is_admin());
drop policy if exists "authors and admins can delete announcements" on public.announcements;
create policy "authors and admins can delete announcements" on public.announcements for delete to authenticated
  using (author_id = auth.uid() or public.current_user_is_admin());

drop policy if exists "users can read own announcement receipts" on public.announcement_reads;
create policy "users can read own announcement receipts" on public.announcement_reads for select to authenticated using (user_id = auth.uid());
drop policy if exists "users can mark announcements read" on public.announcement_reads;
create policy "users can mark announcements read" on public.announcement_reads for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users can update own announcement receipts" on public.announcement_reads;
create policy "users can update own announcement receipts" on public.announcement_reads for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into public.holidays (date, name, kind, created_by)
select v.date::date, v.name, 'national'::public.holiday_kind, p.id
from (values
  ('2026-01-26', 'Republic Day'),
  ('2026-08-15', 'Independence Day'),
  ('2026-10-02', 'Gandhi Jayanti'),
  ('2026-12-25', 'Christmas Day')
) as v(date, name)
cross join lateral (select id from public.profiles where role = 'admin' order by created_at limit 1) p
on conflict (date, name) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('announcements', 'announcements', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
drop policy if exists "authenticated users can read announcements files" on storage.objects;
create policy "authenticated users can read announcements files" on storage.objects for select to authenticated using (bucket_id = 'announcements');
drop policy if exists "staff can upload announcement files" on storage.objects;
create policy "staff can upload announcement files" on storage.objects for insert to authenticated with check (bucket_id = 'announcements' and public.current_user_is_committee_or_admin());
drop policy if exists "staff can update announcement files" on storage.objects;
create policy "staff can update announcement files" on storage.objects for update to authenticated using (bucket_id = 'announcements' and public.current_user_is_committee_or_admin());
drop policy if exists "staff can delete announcement files" on storage.objects;
create policy "staff can delete announcement files" on storage.objects for delete to authenticated using (bucket_id = 'announcements' and public.current_user_is_committee_or_admin());
