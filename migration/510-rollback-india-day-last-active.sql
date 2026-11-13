-- Rollback of 510
begin;
alter function public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer) reset timezone;
alter function public.touch_my_activity() reset timezone;
notify pgrst, 'reload schema';
commit;
