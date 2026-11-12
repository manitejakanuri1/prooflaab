-- 317 (owner E2E report 12 Nov 2026):
--   S4: the task window names who set the task. assigned_by(tasks) is a computed column a student can read for
--       their own task (students cannot read colleges or recruiters): the company, the college's name, "ProofLab
--       admin", "Your onboarding test", "ProofLab" (Daily Lot) or "Your track".
--   CO8: an accepted company invite stays on the student's dashboard ("You accepted <company> · 12 Nov"), so
--       my_shortlists also returns responded_at. Return type changes: dropped and made again, same grants.
-- Rollback: migration/317-rollback-task-assigned-by-and-accepted-invites.sql
begin;
create or replace function public.assigned_by(public.tasks)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select case
           when $1.sponsored_by is not null then (select r.company from public.recruiters r where r.id = $1.sponsored_by)
           when $1.created_by_college_id is not null then (select c.name from public.colleges c where c.id = $1.created_by_college_id)
           when $1.created_by_admin_id is not null then 'ProofLab admin'
           when $1.lot_date is not null then 'ProofLab (Daily Lot)'
           when $1.roadmap_scorecard_id is not null then 'Your onboarding test'
           when $1.level_id is not null then 'Your track'
         end
   where coalesce(public.is_admin(), false)
      or $1.student_id in (select id from public.student_profiles where user_id = (select auth.uid()))
      or exists (select 1 from public.task_assignments ta join public.student_profiles sp on sp.id = ta.student_id
                  where ta.task_id = $1.id and sp.user_id = (select auth.uid()));
$f$;
revoke all on function public.assigned_by(public.tasks) from public, anon;
grant execute on function public.assigned_by(public.tasks) to authenticated, service_role;

drop function if exists public.my_shortlists();
create function public.my_shortlists()
 returns table(id uuid, company text, note text, stage text, student_response text, created_at timestamptz, responded_at timestamptz)
 language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select sl.id, r.company, sl.note, sl.stage, sl.student_response, sl.created_at, sl.responded_at
    from public.recruiter_shortlists sl
    join public.recruiters r on r.id = sl.recruiter_id
   where sl.student_id = (select auth.uid())
   order by sl.created_at desc;
$function$;
revoke all on function public.my_shortlists() from public, anon;
grant execute on function public.my_shortlists() to authenticated, service_role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.assigned_by(public.tasks)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_shortlists()', 'execute') then
    raise exception '317 self-check: grants';
  end if;
  -- as the server (no auth.uid, not admin) the name is hidden
  if exists (select 1 from public.tasks t where public.assigned_by(t) is not null) then
    raise exception '317 self-check: assigned_by visible without a signed-in owner';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
