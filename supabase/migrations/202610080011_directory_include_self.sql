-- The department directory used to hide the signed-in user, so a department whose
-- only member was the viewer showed "No students found" while its card counted them.
-- Include the viewer (always, regardless of visible_in_directory) so the list matches the count.
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
  where p.onboarded
    and (p.id = auth.uid() or p.visible_in_directory or c.status = 'accepted')
    and (dept is null or p.department_id = dept)
    and (degree_filter is null or p.degree = degree_filter)
    and (year_filter is null or p.year = year_filter)
    and (query_text is null or lower(coalesce(p.full_name, '') || ' ' || coalesce(p.username, '') || ' ' || coalesce(p.roll_number, '')) like '%' || lower(query_text) || '%')
    and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
  order by p.id = auth.uid() desc, lower(coalesce(p.full_name, p.username, 'student'))
  limit least(greatest(page_limit, 1), 50) offset greatest(page_offset, 0);
$$;

create or replace function public.directory_departments()
returns table (id uuid, name text, code text, student_count bigint)
language sql stable security definer set search_path = public
as $$
  select d.id, d.name, d.code, count(p.id)
  from public.departments d
  left join public.profiles p on p.department_id = d.id and p.onboarded
    and (p.id = auth.uid() or p.visible_in_directory or exists (
      select 1 from public.connections c where c.status = 'accepted'
        and ((c.requester_id = auth.uid() and c.addressee_id = p.id) or (c.addressee_id = auth.uid() and c.requester_id = p.id))
    ))
  group by d.id, d.name, d.code order by d.name;
$$;

notify pgrst, 'reload schema';
