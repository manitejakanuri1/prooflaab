-- 295 (owner E2E 12 Nov 2026, C5): a college can open and cancel a task it assigned.
--   1. college_assigned_tasks() now counts STUDENTS, not task rows (a task reaches a student either by
--      tasks.student_id or by task_assignments), and returns the description and the task ids of each row.
--   2. college_assigned_task_students(_task_ids): each student of those tasks and how far they got.
--   3. college_cancel_assigned_tasks(_task_ids): removes the task for every student who has NOT handed it in
--      (no submission, no voice answer). Handed-in work is never deleted. Only the caller's own college's tasks.
-- Rollback: migration/295-rollback-college-assigned-task-view-cancel.sql
begin;

drop function if exists public.college_assigned_tasks();
create function public.college_assigned_tasks()
returns table(title text, description text, assigned_at timestamptz, due_date timestamptz,
              students bigint, handed_in bigint, passed bigint, task_ids uuid[])
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  with pairs as (
    select t.id, t.title, t.description, t.due_date, t.created_at, coalesce(a.student_id, t.student_id) as student_id
      from public.tasks t
      left join public.task_assignments a on a.task_id = t.id
     where t.created_by_college_id = public.my_college_id() and t.created_by_college_id is not null)
  select p.title, p.description, min(p.created_at), p.due_date, count(p.student_id),
         count(p.student_id) filter (where exists (select 1 from public.task_submissions s
                                                    where s.task_id = p.id and s.student_id = p.student_id)),
         count(p.student_id) filter (where exists (select 1 from public.task_submissions s
                                                    where s.task_id = p.id and s.student_id = p.student_id and s.status = 'passed')),
         array_agg(distinct p.id)
    from pairs p
   group by p.title, p.description, p.due_date, date_trunc('minute', p.created_at)
   order by min(p.created_at) desc
   limit 200;
$f$;
revoke all on function public.college_assigned_tasks() from public, anon;
grant execute on function public.college_assigned_tasks() to authenticated;

create or replace function public.college_assigned_task_students(_task_ids uuid[])
returns table(student_id uuid, full_name text, roll_number text, state text)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  with pairs as (
    select t.id, coalesce(a.student_id, t.student_id) as student_id
      from public.tasks t
      left join public.task_assignments a on a.task_id = t.id
     where t.id = any(_task_ids)
       and t.created_by_college_id = public.my_college_id() and t.created_by_college_id is not null)
  select p.student_id, sp.full_name, sp.roll_number,
         case when exists (select 1 from public.task_submissions s
                            where s.task_id = p.id and s.student_id = p.student_id and s.status = 'passed') then 'passed'
              when exists (select 1 from public.task_submissions s where s.task_id = p.id and s.student_id = p.student_id)
                or exists (select 1 from public.voice_explanations v where v.task_id = p.id and v.student_id = p.student_id)
                then 'handed_in'
              else 'not_started' end
    from pairs p
    join public.student_profiles sp on sp.id = p.student_id
   order by sp.full_name;
$f$;
revoke all on function public.college_assigned_task_students(uuid[]) from public, anon;
grant execute on function public.college_assigned_task_students(uuid[]) to authenticated;

create or replace function public.college_cancel_assigned_tasks(_task_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare cid uuid := public.my_college_id(); n_asg int; n_tasks int; kept int;
begin
  if cid is null then raise exception 'Only a college can cancel its tasks.' using errcode = '42501'; end if;
  if coalesce(cardinality(_task_ids), 0) = 0 or exists (
       select 1 from unnest(_task_ids) x
        where not exists (select 1 from public.tasks t where t.id = x and t.created_by_college_id = cid)) then
    raise exception 'That task was not assigned by your college.' using errcode = '42501';
  end if;

  -- One task shared by many students (task_assignments): drop the rows of students who have not handed it in.
  delete from public.task_assignments a
   where a.task_id = any(_task_ids)
     and not exists (select 1 from public.task_submissions s where s.task_id = a.task_id and s.student_id = a.student_id)
     and not exists (select 1 from public.voice_explanations v where v.task_id = a.task_id and v.student_id = a.student_id);
  get diagnostics n_asg = row_count;

  -- A task row nobody handed in and nobody is assigned to any more goes (its own student, if any, had not started).
  with gone as (
    delete from public.tasks t
     where t.id = any(_task_ids) and t.created_by_college_id = cid
       and not exists (select 1 from public.task_assignments a where a.task_id = t.id)
       and not exists (select 1 from public.task_submissions s where s.task_id = t.id)
       and not exists (select 1 from public.voice_explanations v where v.task_id = t.id)
       and not exists (select 1 from public.student_levels l where l.task_id = t.id)
    returning t.student_id)
  select count(student_id) into n_tasks from gone;

  select count(*) into kept from public.tasks t
    left join public.task_assignments a on a.task_id = t.id
   where t.id = any(_task_ids) and coalesce(a.student_id, t.student_id) is not null;

  perform public.write_audit('ASSIGNED_TASK_CANCELLED', 'tasks', _task_ids[1], null,
                             jsonb_build_object('task_ids', _task_ids, 'removed', n_asg + n_tasks, 'kept', kept), cid);
  return jsonb_build_object('removed', n_asg + n_tasks, 'kept', kept);
end $f$;
revoke all on function public.college_cancel_assigned_tasks(uuid[]) from public, anon;
grant execute on function public.college_cancel_assigned_tasks(uuid[]) to authenticated;

do $$
begin
  if to_regprocedure('public.college_assigned_task_students(uuid[])') is null
     or to_regprocedure('public.college_cancel_assigned_tasks(uuid[])') is null then
    raise exception '295 self-check: function missing';
  end if;
  if not exists (select 1 from information_schema.routines r join information_schema.parameters p
                   on p.specific_name = r.specific_name
                  where r.routine_name = 'college_assigned_tasks' and p.parameter_name = 'task_ids') then
    raise exception '295 self-check: college_assigned_tasks has no task_ids';
  end if;
  -- An anonymous caller (no college) is refused, never served.
  begin
    perform public.college_cancel_assigned_tasks(array[gen_random_uuid()]);
    raise exception '295 self-check: cancel ran without a college';
  exception when insufficient_privilege then null;
  end;
end $$;
notify pgrst, 'reload schema';
commit;
