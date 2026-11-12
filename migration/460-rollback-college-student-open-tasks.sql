-- Rollback of 460
begin;
drop function if exists public.tpo_open_task_student_ids();
notify pgrst, 'reload schema';
commit;
