-- Run with the Supabase SQL editor or `supabase db test` after applying the migration.
-- The first block proves the database trigger's shared validator rejects lookalikes.
do $$
begin
  if public.is_allowed_college_email('student@evilvjti.ac.in') then
    raise exception 'lookalike domain was accepted';
  end if;
  if public.is_allowed_college_email('student@vjti.ac.in.evil.com') then
    raise exception 'suffix lookalike was accepted';
  end if;
  if not public.is_allowed_college_email('student@cse.vjti.ac.in') then
    raise exception 'valid department subdomain was rejected';
  end if;
end;
$$;

-- With a real authenticated JWT subject substituted below, this must return zero rows
-- for another user's hidden profile, while that user's own row remains readable.
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', '<viewer-uuid>')::text, true);
-- select count(*) from public.profiles where id = '<hidden-profile-uuid>' and visible_in_directory = false;

select policyname, tablename
from pg_policies
where schemaname = 'public' and tablename in ('profiles', 'departments')
order by tablename, policyname;