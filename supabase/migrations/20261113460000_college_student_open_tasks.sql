-- 460 (Grok retest 12 Nov 2026, F7): returns student IDs of students who have an open (assigned, not passed)
-- college task, so the College Students list can show the Remind button for them.
-- Rollback: migration/460-rollback-college-student-open-tasks.sql
begin;

create or replace function public.tpo_open_task_student_ids()
returns table(student_id uuid)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  with mine as (select public.my_college_id() as cid)
  select distinct coalesce(a.student_id, t.student_id) as student_id
    from mine cross join public.tasks t
    left join public.task_assignments a on a.task_id = t.id
   where t.created_by_college_id = mine.cid and mine.cid is not null
     and coalesce(a.student_id, t.student_id) is not null
     and not exists (select 1 from public.task_submissions s
                      where s.task_id = t.id
                        and s.student_id = coalesce(a.student_id, t.student_id)
                        and s.status = 'passed');
$f$;

revoke all on function public.tpo_open_task_student_ids() from public, anon;
grant execute on function public.tpo_open_task_student_ids() to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'tpo_open_task_student_ids') then
    raise exception '460 self-check: tpo_open_task_student_ids not created';
  end if;
  raise notice '460 self-check: true';
end $$;
notify pgrst, 'reload schema';
commit;
