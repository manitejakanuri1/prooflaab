-- Stage 63 - opt the demo fixture students into recruiter discovery.
--
-- Recruiter Talent showed zero candidates. Not a bug in the search:
-- student_is_discoverable() requires BOTH profile_visibility = 'public' AND a
-- student_portfolios row with is_public = true. Every student had the first
-- (it is the column default) and nobody had the second, because
-- student_portfolios defaults to is_public = false and the table was empty.
-- Discovery is opt-in by design, so the fix is data for the fixture, not a
-- weaker gate.
--
-- Only the demo fixture account and the project owner's own account are opted
-- in. The collaborator's real account is deliberately left alone: being shown
-- to recruiters is a consent decision that belongs to that person.
--
-- A related code bug is fixed alongside this: StudentSettingsPage used
-- update() on student_portfolios, which silently did nothing for a student with
-- no portfolio row, so switching "public" on there never made anyone
-- discoverable. It now upserts, as StudentPrivacy already did.

insert into public.student_portfolios (student_id, is_public)
select v.id, true
  from (values
    ('9f77c6d5-bd7c-489e-9410-3db888729328'::uuid),  -- demo.student@prooflab.test
    ('e724043f-cba0-4df6-a4ad-03eb17bf223f'::uuid)   -- project owner's own account
  ) as v(id)
 where exists (select 1 from public.student_profiles p where p.id = v.id)
on conflict (student_id) do update set is_public = true;
