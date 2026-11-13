-- 384 (Grok retest 13 Nov, NEW): when a college gives a student a task, the student gets
-- "New task from <college>: <title>, due <date>" that opens the task. Works for both ways a college task
-- reaches a student: tasks.student_id set directly, or a task_assignments row.
-- Rollback: migration/384-rollback-college-task-notification.sql
begin;

create or replace function public.notify_college_task(_task_id uuid, _student_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare t record; uid uuid; college text; key text := 'college_task:' || _task_id || ':' || _student_id;
begin
  select id, title, due_date, created_by_college_id into t from public.tasks where id = _task_id;
  if t.created_by_college_id is null or _student_id is null then return; end if;
  select user_id into uid from public.student_profiles where id = _student_id;
  if uid is null or exists (select 1 from public.notifications where dedupe_key = key) then return; end if;
  select name into college from public.colleges where id = t.created_by_college_id;
  insert into public.notifications (user_id, audience, source, type, title, message, link, dedupe_key)
  values (uid, 'student', 'system', 'college_task',
          'New task from ' || coalesce(college, 'your college'),
          'New task from ' || coalesce(college, 'your college') || ': ' || coalesce(t.title, 'a task')
            || case when t.due_date is not null
                    then ', due ' || to_char(t.due_date at time zone 'Asia/Kolkata', 'FMDD Mon YYYY') else '' end,
          '/student/tasks/assigned?open=' || _task_id, key);
end $fn$;
revoke all on function public.notify_college_task(uuid, uuid) from public, anon, authenticated;

create or replace function public.tasks_notify_college_task() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin perform public.notify_college_task(new.id, new.student_id); return new; end $fn$;

create or replace function public.task_assignments_notify_college_task() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin perform public.notify_college_task(new.task_id, new.student_id); return new; end $fn$;

drop trigger if exists tasks_zz_notify_college_task on public.tasks;
create trigger tasks_zz_notify_college_task after insert on public.tasks
  for each row when (new.created_by_college_id is not null and new.student_id is not null)
  execute function public.tasks_notify_college_task();

drop trigger if exists task_assignments_zz_notify_college_task on public.task_assignments;
create trigger task_assignments_zz_notify_college_task after insert on public.task_assignments
  for each row execute function public.task_assignments_notify_college_task();

do $$ begin
  if (select count(*) from pg_trigger where tgname in ('tasks_zz_notify_college_task', 'task_assignments_zz_notify_college_task')) <> 2 then
    raise exception '384 self-check: triggers missing'; end if;
  raise notice '384 self-check: true';
end $$;
commit;
