alter table public.stories
  add column if not exists media_path text;

update public.stories
set media_path = substring(media_url from '/stories/(.*)$')
where nullif(media_path, '') is null
  and media_url like '%/stories/%';

create index if not exists stories_media_path_idx
  on public.stories(media_path);

drop policy if exists "authenticated users can read stories bucket" on storage.objects;
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
