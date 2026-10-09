-- Soft-deleting a post with a plain UPDATE fails: the posts SELECT policy only allows
-- deleted_at is null, and Postgres checks the updated row against it, raising
-- "new row violates row-level security policy". Do the soft delete in a definer function instead.
create or replace function public.delete_post(target_post uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_path text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to delete a post';
  end if;

  update public.posts
  set deleted_at = now()
  where id = target_post and author_id = auth.uid() and deleted_at is null
  returning media_path into removed_path;

  if removed_path is null then
    raise exception 'Post not found or you are not its author' using errcode = 'insufficient_privilege';
  end if;

  return removed_path;
end;
$$;

revoke all on function public.delete_post(uuid) from public;
grant execute on function public.delete_post(uuid) to authenticated;

-- Owners must be able to see their own post media, otherwise the storage API cannot
-- remove an image once its post is soft-deleted (deletes only touch visible rows).
drop policy if exists "users read own post media" on storage.objects;
create policy "users read own post media" on storage.objects for select to authenticated
  using (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
