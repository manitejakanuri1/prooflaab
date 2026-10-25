-- ROLLBACK for 135: removes my_achievements(). The badge and quest lists and any badges already saved
-- are kept (deleting earned badges would take something away from students).
begin;
drop function if exists public.my_achievements();
commit;
notify pgrst, 'reload schema';
