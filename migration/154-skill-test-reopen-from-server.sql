-- 154 (MF-043 follow-up): an unfinished skill test is reopened from the server.
-- Before, only browser storage knew a test was open. Clearing site data mid-test lost it: the page offered
-- "Start" again and the student got a fresh set of questions. Now:
--   * resume_test_open_part(assessment) says what is still open: 'quiz', 'coding' or null. A test counts as
--     open only once the server clock (migration 153) has started on it, so tests from before 153 and tests
--     that were built but never shown are not caught.
--   * resume_open_test() hands the owner their open test back, without answers or hidden tests, so the page
--     can reopen it at the same place.
--   * resume-question-generator and resume-coding-generate use resume_test_open_part to return the same
--     test instead of writing new questions while one is open.
-- Rollback: migration/154-rollback-skill-test-reopen-from-server.sql
begin;

create or replace function public.resume_test_open_part(_assessment_id uuid)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when ra.status = 'pending'
     and jsonb_array_length(coalesce(ra.questions, '[]')) > 0
     and exists (select 1 from resume_question_clock c where c.assessment_id = ra.id)
      then 'quiz'
    when ra.status <> 'pending'
     and exists (select 1 from jsonb_array_elements(coalesce(ra.coding_questions, '[]')) q
                   join resume_question_clock c on c.assessment_id = ra.id and c.question_id = q ->> 'id')
     and exists (select 1 from jsonb_array_elements(coalesce(ra.coding_questions, '[]')) q
                  where not (coalesce(ra.coding_results, '{}') ? (q ->> 'id')))
      then 'coding'
  end
  from resume_assessments ra
  where ra.id = _assessment_id
$$;

-- The caller's open test (for one resume claim or interests row, or their latest of any), or null.
-- Same fields the generators send: no correct_index, no explanation, no hidden tests.
create or replace function public.resume_open_test(_resume_claims_id uuid default null,
                                                   _student_interest_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a record;
  part text;
  result jsonb;
begin
  for a in
    select ra.* from resume_assessments ra join student_profiles sp on sp.id = ra.student_id
    where sp.user_id = auth.uid()
      and (_resume_claims_id is null or ra.resume_claims_id = _resume_claims_id)
      and (_student_interest_id is null or ra.student_interest_id = _student_interest_id)
    order by ra.created_at desc
  loop
    part := resume_test_open_part(a.id);
    continue when part is null;

    if part = 'coding' then
      select jsonb_build_object(
               'skill_proof_score', s.skill_proof_score, 'resume_quality_score', s.resume_quality_score,
               'ats_match_score', s.ats_match_score, 'roadmap', s.roadmap, 'skill_gap', s.skill_gap,
               'project_proof_score', s.project_proof_score, 'reasoning_score', s.reasoning_score,
               'interview_readiness_score', s.interview_readiness_score, 'answer_scores', a.answer_scores)
        into result
        from resume_scorecards s where s.assessment_id = a.id;
    end if;

    return jsonb_build_object(
      'assessment_id', a.id,
      'resume_claims_id', a.resume_claims_id,
      'student_interest_id', a.student_interest_id,
      'part', part,
      'questions', coalesce((select jsonb_agg(q - 'correct_index' - 'explanation' order by n)
                             from jsonb_array_elements(coalesce(a.questions, '[]')) with ordinality x(q, n)), '[]'),
      'coding_questions', coalesce((select jsonb_agg(jsonb_build_object(
                                      'id', q ->> 'id', 'language', q ->> 'language', 'prompt', q ->> 'prompt',
                                      'starter_code', q ->> 'starter_code',
                                      'sample_test', case when jsonb_typeof(q -> 'sample_test') = 'object'
                                        then jsonb_build_object('stdin', q -> 'sample_test' -> 'stdin',
                                                                'expected_output', q -> 'sample_test' -> 'expected_output')
                                      end) order by n)
                                    from jsonb_array_elements(coalesce(a.coding_questions, '[]')) with ordinality x(q, n)), '[]'),
      'coding_done', (select count(*) from jsonb_array_elements(coalesce(a.coding_questions, '[]')) q
                       where coalesce(a.coding_results, '{}') ? (q ->> 'id')),
      'result', result);
  end loop;
  return null;
end $$;

revoke all on function public.resume_test_open_part(uuid) from public, anon, authenticated;
grant execute on function public.resume_test_open_part(uuid) to service_role;
revoke all on function public.resume_open_test(uuid, uuid) from public, anon;
grant execute on function public.resume_open_test(uuid, uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.resume_open_test(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.resume_test_open_part(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.resume_test_open_part(uuid)', 'execute') then
    raise exception '154 self-check: the open-test check is reachable from the browser';
  end if;
  if not has_function_privilege('authenticated', 'public.resume_open_test(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.resume_test_open_part(uuid)', 'execute') then
    raise exception '154 self-check: students or the server cannot use the open-test check';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
