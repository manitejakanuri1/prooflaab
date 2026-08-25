-- ============================================================================
-- ProofLabAI smoke test — run this after any migration that touches scoring,
-- squad formation, or the recruiter flow, before trusting it.
--
-- Everything here runs inside one transaction that always rolls back at the
-- end — nothing it does is ever kept, so it is safe to run against the live
-- database at any time.
--
-- Depends on the standing test fixtures documented in START_HERE.md
-- (vidyuthsetu+college / +student1..6 / recruiter1, recruiter2). If those
-- are deleted as part of pre-launch cleanup, point the ids below at whatever
-- fixture replaces them before relying on this again.
--
-- How to run: paste the whole file into the Supabase SQL editor, or hand it
-- to the execute_sql MCP tool as one query.
--
-- A failure raises an exception naming exactly which assertion broke.
-- ============================================================================

begin;

do $$
declare
  season_id uuid;
  result jsonb;
begin
  raise notice '── weekly scoring runs without error ──────────────────────';
  select id into season_id from public.seasons
   where college_id = 'dddddddd-0000-4000-8000-00000000cc01';
  assert season_id is not null, 'no season found for the test college — fixture missing?';

  -- This is the exact call that was silently failing every Sunday until
  -- stage 40b: if run_squad_week (or anything it calls) goes missing or
  -- breaks again, this raises here instead of on a live cron run.
  result := public.run_squad_week(season_id, 7);
  assert (result->>'ok')::boolean, 'run_squad_week did not report ok: ' || result::text;
  raise notice 'PASS: run_squad_week -> %', result;
end $$;

do $$
declare
  admin_uid   uuid := 'dddddddd-0000-4000-8000-00000000c001';
  target_student uuid := 'dddddddd-0000-4000-8000-0000000000f1';
  season      uuid := 'dddddddd-0000-4000-8000-0000000055e1';
  baseline    int;
  overridden  int;
begin
  raise notice '── a college scoring override actually changes the score ───';

  perform public.run_squad_week(season, 7);
  select points into baseline from public.student_weekly_scores
   where student_id = target_student and week = 7;

  perform set_config('request.jwt.claim.sub', admin_uid::text, true);
  set local role authenticated;
  perform public.tpo_set_scoring_weight('voice_recorded', 20);
  reset role;

  perform public.run_squad_week(season, 7);
  select points into overridden from public.student_weekly_scores
   where student_id = target_student and week = 7;

  assert overridden > baseline,
    format('expected the override to raise the score, got baseline=%s overridden=%s', baseline, overridden);
  raise notice 'PASS: score moved from % to % once voice_recorded was raised', baseline, overridden;
end $$;

do $$
declare
  admin_uid uuid := 'dddddddd-0000-4000-8000-00000000c001';
  after_theme text;
begin
  raise notice '── squad naming override resolves correctly ────────────────';

  perform set_config('request.jwt.claim.sub', admin_uid::text, true);
  set local role authenticated;
  perform public.tpo_set_naming_theme('CSE', 'Smoke Test Falcons');
  reset role;

  select t.theme into after_theme
    from public.squad_name_themes t
   where t.branch = 'CSE'
     and (t.college_id = (select id from public.colleges where user_id = admin_uid) or t.college_id is null)
   order by t.college_id nulls last
   limit 1;
  assert after_theme = 'Smoke Test Falcons',
    format('expected the college override to win, got %L', after_theme);
  raise notice 'PASS: CSE theme resolves to the override (%)', after_theme;
end $$;

do $$
declare
  recruiter1 uuid := 'ffffffff-0000-4000-8000-0000000000a1';
  student_id uuid := '3afd8bbf-3071-4919-941f-d27cc6ffbd31';
  lot_rows int;
  status jsonb;
begin
  raise notice '── recruiter cycle: shortlist -> sponsor -> hire -> placement ─';

  perform set_config('request.jwt.claim.sub', recruiter1::text, true);
  set local role authenticated;
  perform public.recruiter_shortlist(student_id, 'smoke test');
  perform public.sponsor_lot(student_id, 'Smoke test lot', 'Brief.', null, 7);
  reset role;

  perform set_config('request.jwt.claim.sub', student_id::text, true);
  set local role authenticated;
  select count(*) into lot_rows from public.my_todays_lot();
  reset role;
  assert lot_rows > 0, 'student has no lot for today after a lot was sponsored';

  perform set_config('request.jwt.claim.sub', recruiter1::text, true);
  set local role authenticated;
  perform public.record_outcome(student_id, 'hired');
  reset role;

  perform set_config('request.jwt.claim.sub', student_id::text, true);
  set local role authenticated;
  select public.my_placement_status() into status;
  reset role;
  assert (status->>'placed')::boolean, 'student was hired but my_placement_status says not placed';
  raise notice 'PASS: recruiter cycle end to end, placement status = %', status;
end $$;

do $$
declare
  student_id uuid := 'dddddddd-0000-4000-8000-0000000000f2';
  interview_id uuid := gen_random_uuid();
  refused boolean := false;
begin
  raise notice '── mock interview answer guards ─────────────────────────────';
  insert into public.mock_interviews (id, student_id, target_role, questions, status)
  values (interview_id, student_id, 'Test Role', '["q1","q2"]'::jsonb, 'answering');

  perform set_config('request.jwt.claim.sub', student_id::text, true);
  set local role authenticated;
  perform public.save_mock_interview_answer(interview_id, 'a.webm', 'answer one', 30);
  perform public.save_mock_interview_answer(interview_id, 'b.webm', 'answer two', 30);

  begin
    perform public.save_mock_interview_answer(interview_id, 'c.webm', 'one too many', 30);
  exception when others then
    refused := true;
  end;
  reset role;
  assert refused, 'save_mock_interview_answer allowed a 3rd answer to a 2-question interview';
  raise notice 'PASS: mock interview answer guards hold';
end $$;

do $$ begin
  raise notice '=== smoke test complete — rolling back, nothing was kept ===';
end $$;

rollback;
