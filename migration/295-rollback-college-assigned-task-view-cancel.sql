-- Rollback of 295: back to the 250 list (no view / cancel). Tasks already cancelled are not brought back.
begin;
drop function if exists public.college_cancel_assigned_tasks(uuid[]);
drop function if exists public.college_assigned_task_students(uuid[]);
drop function if exists public.college_assigned_tasks();
create function public.college_assigned_tasks()
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
notify pgrst, 'reload schema';
commit;
