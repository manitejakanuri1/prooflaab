-- Rollback for 228.
begin;
drop function if exists public.any_language(public.tasks);
notify pgrst, 'reload schema';
commit;
