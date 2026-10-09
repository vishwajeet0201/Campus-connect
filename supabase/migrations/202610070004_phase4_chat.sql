do $$ begin
  create type public.conversation_kind as enum ('dm', 'group');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.conversation_member_role as enum ('member', 'admin');
exception when duplicate_object then null; end $$;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null default 'dm',
  title text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.conversation_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  reply_to uuid references public.messages(id) on delete set null
);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists conversation_members_user_idx on public.conversation_members(user_id, conversation_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index if not exists messages_sender_created_idx on public.messages(sender_id, created_at desc);
create index if not exists blocks_blocked_idx on public.blocks(blocked_id);

create or replace function public.is_conversation_member(target_conversation uuid, target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = target_conversation and user_id = target_user
  );
$$;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

create or replace function public.get_or_create_dm(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  conversation_id uuid;
begin
  if current_user_id is null or other_user is null or current_user_id = other_user then
    raise exception 'A direct message must be between two different users.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles where id in (current_user_id, other_user) and onboarded = true having count(*) = 2) then
    raise exception 'Both users must be onboarded.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.blocks where (blocker_id = current_user_id and blocked_id = other_user) or (blocker_id = other_user and blocked_id = current_user_id)) then
    raise exception 'This user is blocked.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(least(current_user_id::text, other_user::text) || ':' || greatest(current_user_id::text, other_user::text), 0));
  select c.id into conversation_id
  from public.conversations c
  join public.conversation_members a on a.conversation_id = c.id and a.user_id = current_user_id
  join public.conversation_members b on b.conversation_id = c.id and b.user_id = other_user
  where c.kind = 'dm'
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2
  limit 1;
  if conversation_id is not null then return conversation_id; end if;
  insert into public.conversations (kind, created_by) values ('dm', current_user_id) returning id into conversation_id;
  insert into public.conversation_members (conversation_id, user_id, role)
  values (conversation_id, current_user_id, 'admin'), (conversation_id, other_user, 'member');
  return conversation_id;
end;
$$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages for each row execute function public.touch_conversation_last_message();

create or replace function public.enforce_message_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.sender_id::text, 0));
  if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'You can send at most 30 messages per minute.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit before insert on public.messages for each row execute function public.enforce_message_rate_limit();

create or replace view public.chat_list as
select
  cm.user_id,
  c.id as conversation_id,
  c.kind,
  c.title,
  c.last_message_at,
  cm.muted,
  other_profile.id as other_user_id,
  other_profile.full_name as other_full_name,
  other_profile.username as other_username,
  other_profile.avatar_url as other_avatar_url,
  last_message.body as last_message_body,
  last_message.created_at as last_message_created_at,
  (select count(*) from public.messages unread where unread.conversation_id = c.id and unread.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz) and unread.sender_id <> cm.user_id and unread.deleted_at is null) as unread_count
from public.conversation_members cm
join public.conversations c on c.id = cm.conversation_id
left join lateral (
  select p.* from public.conversation_members other_member
  join public.profiles p on p.id = other_member.user_id
  where other_member.conversation_id = c.id and other_member.user_id <> cm.user_id
  limit 1
) other_profile on true
left join lateral (
  select m.body, m.created_at from public.messages m
  where m.conversation_id = c.id and m.deleted_at is null
  order by m.created_at desc limit 1
) last_message on true;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;

drop policy if exists "members can read conversations" on public.conversations;
create policy "members can read conversations" on public.conversations for select to authenticated using (public.is_conversation_member(id));
drop policy if exists "members can read members" on public.conversation_members;
create policy "members can read members" on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));
drop policy if exists "users can update own membership" on public.conversation_members;
create policy "users can update own membership" on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users can leave conversations" on public.conversation_members;
create policy "users can leave conversations" on public.conversation_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists "members can read messages" on public.messages;
create policy "members can read messages" on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));
drop policy if exists "members can insert own messages" on public.messages;
create policy "members can insert own messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id) and not exists (select 1 from public.blocks b join public.conversation_members m on m.conversation_id = messages.conversation_id where m.user_id <> auth.uid() and (b.blocker_id = auth.uid() and b.blocked_id = m.user_id or b.blocker_id = m.user_id and b.blocked_id = auth.uid())));
drop policy if exists "users can delete own messages" on public.messages;
create policy "users can delete own messages" on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
drop policy if exists "users can read own blocks" on public.blocks;
create policy "users can read own blocks" on public.blocks for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "users can manage own blocks" on public.blocks;
create policy "users can manage own blocks" on public.blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid() and blocked_id <> auth.uid());

alter view public.chat_list set (security_invoker = true);
grant select on public.chat_list to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.conversation_members;
exception when duplicate_object then null; end $$;
