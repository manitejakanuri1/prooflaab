-- 502 (Task A, S3): When a student submits a task again, mark 'asked for changes' notification as read and update message
begin;

-- 1. Update any historical notifications where the task has since passed
update public.notifications n
   set is_read = true,
       read_at = coalesce(read_at, now()),
       title = 'You sent it again: Passed',
       message = 'You sent it again: Passed'
 where n.title like '%asked for changes%'
   and exists (
     select 1 from public.task_submissions s
      join public.student_profiles p on p.id = s.student_id
     where p.user_id = n.user_id
       and n.link like '%' || s.task_id || '%'
       and s.status = 'passed'
   );

-- 2. Trigger function to keep notifications in sync on new submissions
create or replace function public.on_task_resubmission_update_notification()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid;
  st text := case when NEW.status = 'passed' then 'Passed' else initcap(NEW.status) end;
begin
  select user_id into uid from public.student_profiles where id = NEW.student_id;
  if uid is not null then
    update public.notifications
       set is_read = true,
           read_at = coalesce(read_at, now()),
           title = 'You sent it again: ' || st,
           message = 'You sent it again: ' || st
     where user_id = uid
       and title like '%asked for changes%'
       and (link like '%' || NEW.task_id || '%' or dedupe_key like 'company_review:%:needs_work');
  end if;
  return NEW;
end;
$$;

drop trigger if exists tr_task_resubmission_notification on public.task_submissions;
create trigger tr_task_resubmission_notification
  after insert on public.task_submissions
  for each row execute function public.on_task_resubmission_update_notification();

commit;
