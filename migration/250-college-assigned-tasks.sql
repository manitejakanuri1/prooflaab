-- 250 (assign test 12 Nov 2026, item 5): a college sees the tasks it assigned, and hears when a student hands one in.
--   1. college_assigned_tasks(): the calling college's own assigned tasks (tasks.created_by_college_id), one row per
--      assignment batch (same title, description and due date, made within the same minute): students, handed in, passed.
--   2. Trigger on task_submissions: the first try a student hands in on a college-assigned task notifies that college
--      once (type assigned_submit, one per task row), linking to College > Assigned tasks (?tab=assigned).
-- Rollback: migration/250-rollback-college-assigned-tasks.sql
begin;

create or replace function public.college_assigned_tasks()
returns table(title text, assigned_at timestamptz, due_date timestamptz, students bigint, handed_in bigint, passed bigint)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select t.title, min(t.created_at), t.due_date, count(*),
         count(*) filter (where exists (select 1 from public.task_submissions s where s.task_id = t.id)),
         count(*) filter (where exists (select 1 from public.task_submissions s where s.task_id = t.id and s.status = 'passed'))
    from public.tasks t
   where t.created_by_college_id = public.my_college_id() and t.created_by_college_id is not null
   group by t.title, t.description, t.due_date, date_trunc('minute', t.created_at)
   order by min(t.created_at) desc
   limit 200;
$f$;
revoke all on function public.college_assigned_tasks() from public, anon;
grant execute on function public.college_assigned_tasks() to authenticated;

create or replace function public.notify_college_assigned_submit()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  insert into public.notifications (user_id, type, title, message, link, source, audience, dedupe_key)
  select c.user_id, 'assigned_submit', 'A student handed in an assigned task',
         coalesce(p.full_name, 'A student') || ' handed in "' || t.title || '".',
         '/college/dashboard?tab=assigned', 'tasks', 'college', 'assigned_submit:' || t.id
    from public.tasks t
    join public.colleges c on c.id = t.created_by_college_id
    left join public.student_profiles p on p.id = new.student_id
   where t.id = new.task_id and c.user_id is not null
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  return null;
end $f$;

drop trigger if exists task_submissions_notify_college on public.task_submissions;
create trigger task_submissions_notify_college after insert on public.task_submissions
  for each row execute function public.notify_college_assigned_submit();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'task_submissions_notify_college') then
    raise exception '250 self-check: trigger missing';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
