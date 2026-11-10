-- 217: the QA Demo company saw no students at all (QA week 8, M8).
--   student_is_discoverable() hides every demo student from every company (173, MF-056), so real companies
--   never see fake students. That also hid the QA Demo students from the QA Demo company, so Home, Talent,
--   Lots and Hiring were empty. Now a demo company (its login is a demo address) sees demo students;
--   a real company still never does. The student's own "Companies can see my profile" switch still applies.
-- Rollback: migration/217-rollback-demo-company-sees-demo-students.sql
begin;

create or replace function public.viewer_is_demo()
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (select 1 from auth.users u
                  where u.id = auth.uid() and u.email ~* '(@qa-demo\.prooflab\.invalid$|\+smoke|\.invalid$|\.local$)');
$fn$;
revoke all on function public.viewer_is_demo() from public, anon, authenticated;
grant execute on function public.viewer_is_demo() to service_role;

create or replace function public.student_is_discoverable(_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1
      from public.student_profiles p
      join public.student_portfolios f on f.student_id = p.id
     where p.id = _student_id
       and p.status = 'active'
       and f.is_public = true)
     -- 173 (MF-056): demo students stay hidden from real companies; 217: a demo company sees them.
     and (not public.is_demo_student(_student_id) or public.viewer_is_demo());
$fn$;

do $$
begin
  if pg_get_functiondef('public.student_is_discoverable(uuid)'::regprocedure) !~ 'viewer_is_demo' then
    raise exception '217: student_is_discoverable was not updated';
  end if;
  -- No signed-in caller here, so a demo student must stay hidden.
  if public.viewer_is_demo() then raise exception '217: viewer_is_demo is true with no caller'; end if;
end $$;

commit;
notify pgrst, 'reload schema';
