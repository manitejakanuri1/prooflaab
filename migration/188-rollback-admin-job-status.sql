-- Rollback of 188.
begin;
drop function if exists public.admin_job_status();
notify pgrst, 'reload schema';
commit;
