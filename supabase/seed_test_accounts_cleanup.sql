-- Removes every test account and all the data seeded with them.
--
-- Run before real students arrive. Already run once, on 7 September 2026: it
-- left 0 students, 0 colleges, 0 squads, 0 seasons and 0 startups behind.
--
-- The earlier version of this file deleted by the id prefix dddddddd-… and
-- would have missed almost everything. Only two fixtures ever had those ids
-- (the college account and the startup account); the sixty students were
-- created later through CSV import and the create-student-users edge
-- function, so they carry ordinary random ids. They are identified instead by
-- their e-mail domain, @test.prooflab.in, which nothing real uses.
--
-- Almost every table hangs off auth.users through ON DELETE CASCADE —
-- student_profiles.id, colleges.user_id, user_roles.user_id — and everything
-- else cascades from student_profiles or colleges in turn. So deleting the
-- accounts is enough, and is safer than a hand-written list of tables that
-- goes stale the moment somebody adds one.
--
-- Usage: paste into the Supabase SQL editor, or apply through the MCP tool.

begin;

-- the sixty seeded students
delete from auth.users where email like '%@test.prooflab.in';

-- the seeded college account and the seeded startup account
delete from auth.users where id::text like 'dddddddd-%';

-- the two seeded recruiter fixtures
delete from auth.users
 where email in ('vidyuthsetu+recruiter1@gmail.com',
                 'vidyuthsetu+recruiter2@gmail.com');

-- squads.college_id is ON DELETE SET NULL, so squad rows outlive the college
-- they belonged to. Their members are gone already (CASCADE from
-- student_profiles), so anything orphaned here is debris.
delete from public.squad_weekly_scores
 where squad_id in (select id from public.squads where college_id is null);
delete from public.squad_matches
 where home_squad in (select id from public.squads where college_id is null)
    or away_squad in (select id from public.squads where college_id is null);
delete from public.squads where college_id is null;

-- Should all be zero afterwards.
select (select count(*) from public.student_profiles) as students_left,
       (select count(*) from public.colleges)         as colleges_left,
       (select count(*) from public.squads)           as squads_left,
       (select count(*) from public.startups)         as startups_left;

commit;

-- NOT deleted here, on purpose:
--
--   vidyuthsetu+admin@gmail.com  — the real administrator. Its password is
--     still the shared test one; change it through "Forgot password" on the
--     sign-in page before launch.
--
--   vidyuthsetu+recruitercheck@gmail.com — created on 7 September 2026 to
--     prove the recruiter journey end to end against the live database
--     (role claim, workspace, the awaiting-verification gate, approval, and
--     the candidate list opening up afterwards). It is approved and has a
--     company called "Checkpoint Hiring". Keep it while you are still
--     clicking through the recruiter dashboard; to remove it afterwards:
--
--       delete from auth.users where email = 'vidyuthsetu+recruitercheck@gmail.com';
--
-- Storage is not touched here. A protect_delete trigger blocks deleting
-- storage.objects rows from SQL, and deleting them anyway would leave the
-- file bytes orphaned in S3. Empty the `resumes` bucket from the Supabase
-- dashboard instead (31 test files, 2 MB, as of 7 September 2026).
