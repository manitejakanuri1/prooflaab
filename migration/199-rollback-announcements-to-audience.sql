-- Rollback of 199: no more bell notices or banner list for announcements. The audience column is kept
-- (dropping it would lose the admin's choices); notices already sent stay.
begin;
drop trigger if exists announcement_fan_out on public.announcements;
drop function if exists public.announcement_fan_out();
drop function if exists public.my_announcements();
commit;
