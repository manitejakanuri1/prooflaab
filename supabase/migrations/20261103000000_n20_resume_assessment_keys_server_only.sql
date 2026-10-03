-- 50: resume answer keys and hidden coding tests become server-only (N20).
--
-- Found 3 Oct 2026 and proven on staging: policy resume_assessments_own_all was
-- FOR ALL, so a student could read their own row - including questions[].correct_index
-- and coding_questions[].test_cases (the hidden tests) - and PATCH it: rewrite the
-- answer key, the hidden tests or started_at (the timer) before submitting. The
-- grader (resume-assessment-submit / resume-code-execute) trusts the stored row.
--
-- After this: a student may only SELECT safe columns of their own row. Every
-- write, and every read of questions / coding_questions / coding_results, is the
-- server's alone (functions use service_role). The browser only ever read
-- answer_scores (StudentResumeHistoryPage); that stays readable.
--
-- Rollback: migration/50-rollback-resume-assessment-keys.sql
begin;

drop policy if exists resume_assessments_own_all on public.resume_assessments;
drop policy if exists resume_assessments_own_select on public.resume_assessments;
create policy resume_assessments_own_select on public.resume_assessments
  for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

revoke all on public.resume_assessments from public, anon, authenticated;
grant select (id, student_id, resume_claims_id, student_interest_id, answer_scores, status,
              is_retest, started_at, elapsed_seconds, retest_notified_at, created_at, updated_at)
  on public.resume_assessments to authenticated;
grant all on public.resume_assessments to service_role;

do $$
begin
  if has_column_privilege('authenticated', 'public.resume_assessments', 'questions', 'SELECT')
     or has_column_privilege('authenticated', 'public.resume_assessments', 'coding_questions', 'SELECT')
     or has_column_privilege('authenticated', 'public.resume_assessments', 'coding_results', 'SELECT') then
    raise exception 'a student could still read answer keys or hidden tests';
  end if;
  if has_table_privilege('authenticated', 'public.resume_assessments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.resume_assessments', 'INSERT')
     or has_table_privilege('authenticated', 'public.resume_assessments', 'DELETE')
     or has_column_privilege('authenticated', 'public.resume_assessments', 'questions', 'UPDATE') then
    raise exception 'a student could still write their own assessment';
  end if;
  if not has_column_privilege('authenticated', 'public.resume_assessments', 'answer_scores', 'SELECT') then
    raise exception 'the resume history page could no longer read answer_scores';
  end if;
  if not has_table_privilege('service_role', 'public.resume_assessments', 'UPDATE') then
    raise exception 'the server lost write access';
  end if;
  if exists (select 1 from pg_policies where tablename = 'resume_assessments' and policyname = 'resume_assessments_own_all') then
    raise exception 'old FOR ALL policy still present';
  end if;
  raise notice '50: resume answer keys and hidden tests are server-only';
end $$;

commit;
notify pgrst, 'reload schema';
