-- Run after 202610070008_phase7_profiles.sql with two authenticated users.
select * from public.profile_summary('target_username');
-- Expected integration assertions:
-- 1. Hidden stranger profiles return no summary and their posts are unreadable.
-- 2. Connected users can read a hidden profile and its non-deleted posts.
-- 3. Only the post owner can insert or soft-delete a post.
-- 4. Storage uploads outside <auth.uid()>/ are rejected.
-- 5. Only the highlight owner can modify highlights and highlight items.
-- 6. Roll numbers are returned only when the requested profile is auth.uid().
-- 7. A user can update only their own privacy and settings rows.
