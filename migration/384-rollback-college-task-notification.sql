begin;
drop trigger if exists tasks_zz_notify_college_task on public.tasks;
drop trigger if exists task_assignments_zz_notify_college_task on public.task_assignments;
drop function if exists public.tasks_notify_college_task();
drop function if exists public.task_assignments_notify_college_task();
drop function if exists public.notify_college_task(uuid, uuid);
commit;
