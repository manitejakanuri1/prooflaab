-- Rollback for 502: drop tr_task_resubmission_notification and its function
begin;
drop trigger if exists tr_task_resubmission_notification on public.task_submissions;
drop function if exists public.on_task_resubmission_update_notification();
commit;
