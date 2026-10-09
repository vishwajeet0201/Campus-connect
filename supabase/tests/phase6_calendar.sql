-- Run after 202610070007_phase6_calendar.sql with authenticated users
-- representing a student, a committee member, and an administrator.
select * from public.holidays order by date;
select * from public.events order by starts_at;
select * from public.announcements order by pinned desc, created_at desc;
-- Expected integration assertions:
-- 1. A student insert into holidays/events/announcements is rejected.
-- 2. A committee member can create and edit only their own events/announcements.
-- 3. An administrator can edit and delete all events/announcements and holidays.
-- 4. A department-scoped announcement is visible to matching department users only.
-- 5. An everyone announcement is visible to every authenticated user.
-- 6. announcement_reads can only be inserted or changed for auth.uid().
-- 7. announcement files are readable by authenticated users and writable only by staff.
