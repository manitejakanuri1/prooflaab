-- 155: fix to 154. A test counts as open only while it can still be finished.
-- Found on TEST: a quiz started hours earlier was reopened, the hand-in was then refused as over time
-- (resume-assessment-submit marks it 'expired'), and 154 went on calling it an open coding round because it
-- only checked status <> 'pending'. Now:
--   * quiz: still pending AND inside the hand-in allowance (30 s per MCQ, 90 s per written question, plus
--     600 s; must match secondsFor and TIME_GRACE_SECONDS in resume-assessment-submit).
--   * coding: only after a quiz that was graded.
-- A dead attempt is then not reopened, and Start builds a fresh test as before.
-- Rollback: migration/155-rollback-skill-test-open-only-if-finishable.sql (puts back the 154 body)
begin;

create or replace function public.resume_test_open_part(_assessment_id uuid)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when ra.status = 'pending'
     and jsonb_array_length(coalesce(ra.questions, '[]')) > 0
     and exists (select 1 from resume_question_clock c where c.assessment_id = ra.id)
     and (ra.started_at is null
          or ra.started_at + make_interval(secs => 600 + (select sum(case when q ->> 'type' = 'mcq' then 30 else 90 end)
                                                           from jsonb_array_elements(ra.questions) q)) > now())
      then 'quiz'
    when ra.status = 'graded'
     and exists (select 1 from jsonb_array_elements(coalesce(ra.coding_questions, '[]')) q
                   join resume_question_clock c on c.assessment_id = ra.id and c.question_id = q ->> 'id')
     and exists (select 1 from jsonb_array_elements(coalesce(ra.coding_questions, '[]')) q
                  where not (coalesce(ra.coding_results, '{}') ? (q ->> 'id')))
      then 'coding'
  end
  from resume_assessments ra
  where ra.id = _assessment_id
$$;

do $$
begin
  if has_function_privilege('authenticated', 'public.resume_test_open_part(uuid)', 'execute')
     or has_function_privilege('anon', 'public.resume_test_open_part(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.resume_test_open_part(uuid)', 'execute') then
    raise exception '155 self-check: resume_test_open_part permissions changed';
  end if;
end $$;

commit;
