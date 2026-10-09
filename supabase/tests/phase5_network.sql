-- Run after 202610070006_phase5_network.sql in a Supabase SQL editor.
-- Execute each assertion as an authenticated test user with auth.uid() set by the
-- test harness. The RPCs intentionally return no roll_number or email.
select public.directory_departments();
select public.directory_students(null, null, null, null, 20, 0);
-- Expected integration assertions for a seeded harness:
-- 1. hidden, unconnected profiles are absent from both RPCs.
-- 2. connect_request(other) creates one pending row; a second call returns it.
-- 3. reverse connect_request accepts the existing pending row.
-- 4. a non-addressee update is rejected by RLS.
-- 5. either direction of blocks hides the profile and connect_request rejects it.
-- 6. a self-request is rejected and the 31st request in one hour is rejected.
