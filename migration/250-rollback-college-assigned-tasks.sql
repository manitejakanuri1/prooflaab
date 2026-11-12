-- Rollback for 250. Notifications already sent stay.
begin;
drop trigger if exists task_submissions_notify_college on public.task_submissions;
drop function if exists public.notify_college_assigned_submit();
drop function if exists public.college_assigned_tasks();
notify pgrst, 'reload schema';
commit;
