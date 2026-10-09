create or replace function public.create_post(post_media_path text, post_caption text default '')
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  created_post public.posts;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create a post';
  end if;

  insert into public.posts (author_id, media_path, media_type, caption)
  values (auth.uid(), post_media_path, 'image', left(coalesce(post_caption, ''), 2200))
  returning * into created_post;

  return created_post;
end;
$$;

revoke all on function public.create_post(text, text) from public;
grant execute on function public.create_post(text, text) to authenticated;
