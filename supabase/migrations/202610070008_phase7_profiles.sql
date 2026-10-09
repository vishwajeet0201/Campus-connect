do $$ begin
  create type public.post_media_type as enum ('image');
exception when duplicate_object then null; end $$;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  media_path text not null,
  media_type public.post_media_type not null default 'image',
  caption text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  cover_path text,
  created_at timestamptz not null default now()
);
create table if not exists public.highlight_items (
  highlight_id uuid not null references public.highlights(id) on delete cascade,
  story_media_path text not null,
  position integer not null default 0,
  primary key (highlight_id, story_media_path)
);
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mute_chat_sounds boolean not null default false,
  announcement_alerts boolean not null default true,
  appearance text not null default 'system',
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists username_changed_at timestamptz;
alter table public.profiles add column if not exists account_deletion_requested_at timestamptz;

create index if not exists posts_author_created_idx on public.posts(author_id, created_at desc);
create index if not exists highlights_owner_created_idx on public.highlights(owner_id, created_at);

create or replace function public.profile_summary(profile_username text)
returns table (
  id uuid, username text, username_changed_at timestamptz, full_name text, bio text, avatar_url text, roll_number text,
  role public.app_role, department_id uuid, department_name text, degree public.degree_level,
  year integer, posts_count bigint, connections_count bigint,
  my_connection_status public.connection_status, blocked_me boolean, has_active_story boolean
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.username_changed_at, p.full_name, p.bio,
    p.avatar_url, case when p.id = auth.uid() then p.roll_number else null end,
    p.role, p.department_id, d.name, p.degree, p.year,
    (select count(*) from public.posts po where po.author_id = p.id and po.deleted_at is null),
    (select count(*) from public.connections c where c.status = 'accepted' and (c.requester_id = p.id or c.addressee_id = p.id)),
    c.status,
    exists (select 1 from public.blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid()),
    exists (select 1 from public.stories s where s.author_id = p.id and s.expires_at > now())
  from public.profiles p
  left join public.departments d on d.id = p.department_id
  left join public.connections c on least(c.requester_id, c.addressee_id) = least(auth.uid(), p.id)
    and greatest(c.requester_id, c.addressee_id) = greatest(auth.uid(), p.id)
  where ((profile_username is null and p.id = auth.uid()) or lower(p.username) = lower(profile_username))
    and (p.id = auth.uid() or p.visible_in_directory or c.status = 'accepted')
    and not exists (select 1 from public.blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid());
$$;
grant execute on function public.profile_summary(text) to authenticated;

alter table public.posts enable row level security;
alter table public.highlights enable row level security;
alter table public.highlight_items enable row level security;
alter table public.user_settings enable row level security;

create or replace function public.can_view_profile(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select not exists (
  select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = target)
    or (b.blocker_id = target and b.blocked_id = auth.uid())
) and (target = auth.uid() or exists (
  select 1 from public.profiles p where p.id = target and p.visible_in_directory
) or exists (
  select 1 from public.connections c where c.status = 'accepted'
    and ((c.requester_id = auth.uid() and c.addressee_id = target) or (c.addressee_id = auth.uid() and c.requester_id = target))
)); $$;

drop policy if exists "visible users can read posts" on public.posts;
create policy "visible users can read posts" on public.posts for select to authenticated
  using (deleted_at is null and public.can_view_profile(author_id));
drop policy if exists "authors can create posts" on public.posts;
create policy "authors can create posts" on public.posts for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "authors can soft delete posts" on public.posts;
create policy "authors can soft delete posts" on public.posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "visible users can read highlights" on public.highlights;
create policy "visible users can read highlights" on public.highlights for select to authenticated using (public.can_view_profile(owner_id));
drop policy if exists "owners can create highlights" on public.highlights;
create policy "owners can create highlights" on public.highlights for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "owners can update highlights" on public.highlights;
create policy "owners can update highlights" on public.highlights for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "owners can delete highlights" on public.highlights;
create policy "owners can delete highlights" on public.highlights for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "visible users can read highlight items" on public.highlight_items;
create policy "visible users can read highlight items" on public.highlight_items for select to authenticated using (exists (select 1 from public.highlights h where h.id = highlight_id and public.can_view_profile(h.owner_id)));
drop policy if exists "owners can manage highlight items" on public.highlight_items;
create policy "owners can manage highlight items" on public.highlight_items for all to authenticated using (exists (select 1 from public.highlights h where h.id = highlight_id and h.owner_id = auth.uid())) with check (exists (select 1 from public.highlights h where h.id = highlight_id and h.owner_id = auth.uid()));

drop policy if exists "users manage own settings" on public.user_settings;
create policy "users manage own settings" on public.user_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posts', 'posts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "authenticated users read post media" on storage.objects;
create policy "authenticated users read post media" on storage.objects for select to authenticated using (
  bucket_id = 'posts'
  and (
    exists (select 1 from public.posts p where p.media_path = name and p.deleted_at is null and public.can_view_profile(p.author_id))
    or exists (select 1 from public.highlights h where h.cover_path = name and public.can_view_profile(h.owner_id))
    or exists (select 1 from public.highlight_items hi join public.highlights h on h.id = hi.highlight_id where hi.story_media_path = name and public.can_view_profile(h.owner_id))
  )
);
drop policy if exists "users upload own post media" on storage.objects;
create policy "users upload own post media" on storage.objects for insert to authenticated with check (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text and coalesce((metadata->>'size')::bigint, 0) <= 10485760 and coalesce(metadata->>'mimetype', '') in ('image/jpeg', 'image/png', 'image/webp'));
drop policy if exists "users update own post media" on storage.objects;
create policy "users update own post media" on storage.objects for update to authenticated using (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users delete own post media" on storage.objects;
create policy "users delete own post media" on storage.objects for delete to authenticated using (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);
