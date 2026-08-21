-- Removes every test account and all the data seeded with them.
--
-- Run this before real students arrive. These accounts exist only so all four
-- dashboards can be opened and clicked through; they share one password, and a
-- shared password is fine for a fixture and not fine for anything else.
--
-- Everything seeded sits under two id prefixes, so this deletes exactly the
-- fixture and nothing else:
--   dddddddd-…  the college, its students, squads and season
--   the +admin account is kept — it is the real administrator, not a fixture
--
-- Usage: paste into the Supabase SQL editor, or apply through the MCP tool.

begin;

delete from public.audit_logs             where college_id = 'dddddddd-0000-4000-8000-00000000cc01';
delete from public.interventions          where college_id = 'dddddddd-0000-4000-8000-00000000cc01';
delete from public.notifications          where user_id::text like 'dddddddd-0000-4000-8000-%';
delete from public.student_skills         where student_id in
  (select id from public.student_profiles where college_id = 'dddddddd-0000-4000-8000-00000000cc01');
delete from public.student_weekly_scores  where squad_id in
  (select id from public.squads where college_id = 'dddddddd-0000-4000-8000-00000000cc01');
delete from public.squad_weekly_scores    where season_id = 'dddddddd-0000-4000-8000-0000000055e1';
delete from public.voice_explanations     where student_id in
  (select id from public.student_profiles where college_id = 'dddddddd-0000-4000-8000-00000000cc01');
delete from public.task_assignments       where student_id in
  (select id from public.student_profiles where college_id = 'dddddddd-0000-4000-8000-00000000cc01');
delete from public.student_activity_events where college_id = 'dddddddd-0000-4000-8000-00000000cc01';
delete from public.squad_members          where squad_id in
  (select id from public.squads where college_id = 'dddddddd-0000-4000-8000-00000000cc01');
delete from public.squad_matches          where season_id = 'dddddddd-0000-4000-8000-0000000055e1';
delete from public.squads                 where college_id = 'dddddddd-0000-4000-8000-00000000cc01';
delete from public.seasons                where college_id = 'dddddddd-0000-4000-8000-00000000cc01';
delete from public.student_contact        where student_id in
  (select id from public.student_profiles where college_id = 'dddddddd-0000-4000-8000-00000000cc01');
delete from public.student_profiles       where college_id = 'dddddddd-0000-4000-8000-00000000cc01';
delete from public.college_profiles       where user_id = 'dddddddd-0000-4000-8000-00000000c001';
delete from public.colleges               where id = 'dddddddd-0000-4000-8000-00000000cc01';
delete from public.job_opportunities      where created_by = 'dddddddd-0000-4000-8000-00000000d001';
delete from public.startup_profiles       where user_id = 'dddddddd-0000-4000-8000-00000000d001';
delete from public.startups               where user_id = 'dddddddd-0000-4000-8000-00000000d001';
delete from public.user_roles             where user_id::text like 'dddddddd-0000-4000-8000-%';
delete from auth.identities               where user_id::text like 'dddddddd-0000-4000-8000-%';
delete from auth.users                    where id::text      like 'dddddddd-0000-4000-8000-%';

-- Should all be zero afterwards.
select (select count(*) from auth.users where id::text like 'dddddddd-%')      as test_users,
       (select count(*) from public.student_profiles
         where college_id = 'dddddddd-0000-4000-8000-00000000cc01')            as test_students,
       (select count(*) from public.colleges)                                  as colleges_left,
       (select count(*) from public.startups)                                  as startups_left;

commit;

-- The real administrator (vidyuthsetu+admin@gmail.com) is deliberately NOT
-- deleted here. Its password is the shared test one, so change it through
-- "Forgot password" on the sign-in page before launch.
