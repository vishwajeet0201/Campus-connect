create or replace function public.enforce_story_insert_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_role public.app_role;
  onboarded_user boolean;
  story_count integer;
begin
  if new.author_id is distinct from auth.uid() then
    raise exception 'Stories must be created for the authenticated user.' using errcode = 'check_violation';
  end if;

  select p.role, p.onboarded into profile_role, onboarded_user
  from public.profiles p
  where p.id = auth.uid();

  if onboarded_user is not true then
    raise exception 'Only onboarded users may post stories.' using errcode = 'check_violation';
  end if;

  if new.kind = 'student' then
    -- Any onboarded authenticated user may post as a student story.
    null;
  elsif new.kind in ('committee', 'official') then
    if profile_role not in ('committee', 'admin') then
      raise exception 'Only committee or admin accounts can post committee and official stories.' using errcode = 'check_violation';
    end if;
  else
    raise exception 'Story kind is invalid.' using errcode = 'check_violation';
  end if;

  select count(*) into story_count
  from public.stories
  where author_id = auth.uid()
    and created_at >= now() - interval '24 hours';

  if story_count >= 10 then
    raise exception 'You have reached the 10-story limit for the last 24 hours.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_story_insert_policy on public.stories;
create trigger enforce_story_insert_policy
  before insert on public.stories
  for each row execute function public.enforce_story_insert_policy();

create or replace function public.current_user_can_post_story()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.onboarded = true
  );
$$;

grant execute on function public.current_user_can_post_story() to authenticated;

drop policy if exists "committee/admin can insert stories" on public.stories;
drop policy if exists "students can insert stories when allowed" on public.stories;
drop policy if exists "authenticated onboarded users can insert student stories" on public.stories;
drop policy if exists "committee/admin can insert official stories" on public.stories;
drop policy if exists "authenticated users can read active stories" on public.stories;
drop policy if exists "users can delete their own stories" on public.stories;
drop policy if exists "admins can delete any story" on public.stories;
create policy "authenticated onboarded users can insert student stories"
on public.stories for insert to authenticated
with check (
  author_id = auth.uid()
  and kind = 'student'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.onboarded = true
  )
);
create policy "committee/admin can insert official stories"
on public.stories for insert to authenticated
with check (
  author_id = auth.uid()
  and kind in ('committee', 'official')
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('committee', 'admin')
  )
);
create policy "authenticated users can read active stories"
on public.stories for select to authenticated using (expires_at > now());
create policy "users can delete their own stories"
on public.stories for delete to authenticated using (author_id = auth.uid());
create policy "admins can delete any story"
on public.stories for delete to authenticated using (public.current_user_is_admin());

drop policy if exists "users can upload story media in own folder" on storage.objects;
drop policy if exists "users can update their own story media" on storage.objects;
drop policy if exists "users can delete their own story media" on storage.objects;
drop policy if exists "authenticated users can read stories bucket" on storage.objects;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "authenticated users can read stories bucket"
on storage.objects for select to authenticated using (bucket_id = 'stories');
create policy "users can upload story media in own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = auth.uid()::text
  and coalesce((metadata->>'size')::bigint, 0) <= 10485760
  and (metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'))
);
create policy "users can update their own story media"
on storage.objects for update to authenticated
using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text)
with check (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = auth.uid()::text
  and coalesce((metadata->>'size')::bigint, 0) <= 10485760
  and (coalesce(metadata->>'mimetype', '') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'))
);
create policy "users can delete their own story media"
on storage.objects for delete to authenticated using (
  bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text
);
