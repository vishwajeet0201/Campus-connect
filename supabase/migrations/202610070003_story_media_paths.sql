alter table public.stories
  add column if not exists media_path text;

alter table public.stories
  alter column media_url drop not null;

update public.stories
set media_path = regexp_replace(media_url, '^.*/stories/', '')
where nullif(media_path, '') is null
  and media_url is not null;

create index if not exists stories_media_path_idx
  on public.stories(media_path);

drop policy if exists "authenticated users can read stories bucket" on storage.objects;
drop policy if exists "authenticated users can read active story media" on storage.objects;
create policy "authenticated users can read active story media"
on storage.objects for select to authenticated using (
  bucket_id = 'stories'
  and exists (
    select 1
    from public.stories
    where stories.media_path = storage.objects.name
      and stories.expires_at > now()
  )
);

drop policy if exists "users can upload story media in own folder" on storage.objects;
create policy "users can upload story media in own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = auth.uid()::text
  and coalesce((metadata->>'size')::bigint, 0) <= 10485760
  and coalesce(metadata->>'mimetype', '') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm')
);

drop policy if exists "users can update their own story media" on storage.objects;
create policy "users can update their own story media"
on storage.objects for update to authenticated
using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text)
with check (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = auth.uid()::text
  and coalesce((metadata->>'size')::bigint, 0) <= 10485760
  and coalesce(metadata->>'mimetype', '') in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm')
);

drop policy if exists "users can delete their own story media" on storage.objects;
create policy "users can delete their own story media"
on storage.objects for delete to authenticated using (
  bucket_id = 'stories'
  and (storage.foldername(name))[1] = auth.uid()::text
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.cleanup_orphaned_story_media()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  removed_count integer;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only administrators can clean up story media.' using errcode = 'insufficient_privilege';
  end if;

  with removed as (
    delete from storage.objects
    where bucket_id = 'stories'
      and created_at < now() - interval '1 hour'
      and not exists (
        select 1 from public.stories
        where stories.media_path = storage.objects.name
      )
    returning 1
  )
  select count(*) into removed_count from removed;

  return removed_count;
end;
$$;

grant execute on function public.cleanup_orphaned_story_media() to authenticated;

create or replace function public.expire_stories()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects
  where bucket_id = 'stories'
    and name in (
      select media_path
      from public.stories
      where expires_at <= now()
        and media_path is not null
    );

  delete from public.stories where expires_at <= now();
end;
$$;

grant execute on function public.expire_stories() to authenticated;

drop policy if exists "users can update own story view" on public.story_views;
create policy "users can update own story view"
on public.story_views for update to authenticated
using (viewer_id = auth.uid())
with check (viewer_id = auth.uid());

notify pgrst, 'reload schema';
