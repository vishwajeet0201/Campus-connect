do $$ begin
  create type public.connection_status as enum ('pending', 'accepted', 'declined');
exception when duplicate_object then null;
end $$;

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint connections_not_self check (requester_id <> addressee_id)
);

create unique index if not exists connections_unique_pair_idx
  on public.connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists profiles_directory_filter_idx
  on public.profiles (department_id, degree, year);
create index if not exists profiles_directory_search_idx
  on public.profiles (lower(coalesce(full_name, '') || ' ' || coalesce(username, '') || ' ' || coalesce(roll_number, '')));
create index if not exists connections_requester_idx on public.connections(requester_id, status);
create index if not exists connections_addressee_idx on public.connections(addressee_id, status);

alter table public.connections enable row level security;
drop policy if exists "participants can read connections" on public.connections;
create policy "participants can read connections" on public.connections for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
drop policy if exists "requesters can create pending connections" on public.connections;
create policy "requesters can create pending connections" on public.connections for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');
drop policy if exists "addressees can respond to connections" on public.connections;
create policy "addressees can respond to connections" on public.connections for update to authenticated
  using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());
drop policy if exists "participants can delete connections" on public.connections;
create policy "participants can delete connections" on public.connections for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create or replace function public.connect_request(other uuid)
returns public.connections
language plpgsql
security definer set search_path = public
as $$
declare
  existing public.connections;
  result public.connections;
begin
  if auth.uid() is null or other is null or auth.uid() = other then
    raise exception 'You cannot connect to yourself.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.blocks where (blocker_id = auth.uid() and blocked_id = other) or (blocker_id = other and blocked_id = auth.uid())) then
    raise exception 'This user is blocked.' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.connections where requester_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You have reached the hourly connection request limit.' using errcode = 'check_violation';
  end if;
  select * into existing from public.connections
    where least(requester_id, addressee_id) = least(auth.uid(), other)
      and greatest(requester_id, addressee_id) = greatest(auth.uid(), other)
    for update;
  if existing.id is not null then
    if existing.requester_id = other and existing.addressee_id = auth.uid() and existing.status = 'pending' then
      update public.connections set status = 'accepted', responded_at = now() where id = existing.id returning * into result;
      return result;
    end if;
    return existing;
  end if;
  insert into public.connections (requester_id, addressee_id) values (auth.uid(), other) returning * into result;
  return result;
end;
$$;
grant execute on function public.connect_request(uuid) to authenticated;

create or replace function public.directory_departments()
returns table (id uuid, name text, code text, student_count bigint)
language sql stable security definer set search_path = public
as $$
  select d.id, d.name, d.code, count(p.id)
  from public.departments d
  left join public.profiles p on p.department_id = d.id and p.onboarded
    and (p.visible_in_directory or exists (
      select 1 from public.connections c where c.status = 'accepted'
        and ((c.requester_id = auth.uid() and c.addressee_id = p.id) or (c.addressee_id = auth.uid() and c.requester_id = p.id))
    ))
  group by d.id, d.name, d.code order by d.name;
$$;
grant execute on function public.directory_departments() to authenticated;

create or replace function public.directory_students(dept uuid default null, degree_filter public.degree_level default null, year_filter integer default null, query_text text default null, page_limit integer default 20, page_offset integer default 0)
returns table (id uuid, full_name text, username text, bio text, avatar_url text, department_id uuid, department_name text, degree public.degree_level, year integer, connection_status public.connection_status, connection_id uuid)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.username, p.bio, p.avatar_url, p.department_id, d.name, p.degree, p.year,
    c.status, c.id
  from public.profiles p
  left join public.departments d on d.id = p.department_id
  left join public.connections c on least(c.requester_id, c.addressee_id) = least(auth.uid(), p.id)
    and greatest(c.requester_id, c.addressee_id) = greatest(auth.uid(), p.id)
  where p.onboarded and p.id <> auth.uid()
    and (p.visible_in_directory or c.status = 'accepted')
    and (dept is null or p.department_id = dept)
    and (degree_filter is null or p.degree = degree_filter)
    and (year_filter is null or p.year = year_filter)
    and (query_text is null or lower(coalesce(p.full_name, '') || ' ' || coalesce(p.username, '') || ' ' || coalesce(p.roll_number, '')) like '%' || lower(query_text) || '%')
    and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
  order by lower(coalesce(p.full_name, p.username, 'student'))
  limit least(greatest(page_limit, 1), 50) offset greatest(page_offset, 0);
$$;
grant execute on function public.directory_students(uuid, public.degree_level, integer, text, integer, integer) to authenticated;

create or replace function public.directory_relationships(kind text)
returns table (id uuid, full_name text, username text, bio text, avatar_url text, department_id uuid, department_name text, degree public.degree_level, year integer, connection_status public.connection_status, connection_id uuid)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.username, p.bio, p.avatar_url, p.department_id, d.name, p.degree, p.year,
    c.status, c.id
  from public.connections c
  join public.profiles p on p.id = case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end
  left join public.departments d on d.id = p.department_id
  where (c.requester_id = auth.uid() or c.addressee_id = auth.uid())
    and ((kind = 'connections' and c.status = 'accepted') or (kind = 'requests' and c.status = 'pending'))
    and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
  order by c.created_at desc;
$$;
grant execute on function public.directory_relationships(text) to authenticated;

notify pgrst, 'reload schema';
