-- Rollback for 233.
begin;
alter function public.tpo_home() reset timezone;
alter function public.tpo_insights() reset timezone;
commit;
