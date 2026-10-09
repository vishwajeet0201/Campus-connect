-- Run with two authenticated test users in a Supabase SQL session.
-- Replace the UUID placeholders and execute each block with the matching JWT.

-- User A can create exactly one DM with user B.
select public.get_or_create_dm('<user-b-uuid>') as conversation_id;
select public.get_or_create_dm('<user-b-uuid>') as same_conversation_id;

-- User A can read their conversation and messages.
select count(*) from public.conversations
where id = '<conversation-uuid>';
select count(*) from public.messages
where conversation_id = '<conversation-uuid>';

-- User A cannot read or write user C's conversation.
-- Expected: zero rows for the read and an RLS error for the insert.
select count(*) from public.messages
where conversation_id = '<user-c-conversation-uuid>';
insert into public.messages (conversation_id, sender_id, body)
values ('<user-c-conversation-uuid>', '<user-a-uuid>', 'must fail');

-- Rate limit: the 31st insert in a rolling minute must fail.
-- select generate_series(1, 31) as n \gexec
-- insert into public.messages (conversation_id, sender_id, body)
-- values ('<conversation-uuid>', '<user-a-uuid>', 'rate-limit test');

-- Block user B as user A, then the DM RPC must fail.
insert into public.blocks (blocker_id, blocked_id)
values ('<user-a-uuid>', '<user-b-uuid>');
select public.get_or_create_dm('<user-b-uuid>'); -- expected: blocked-user error
