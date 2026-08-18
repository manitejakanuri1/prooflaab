-- ============================================================================
-- Stage 2 fix — one assessment per source, enforced.
--
-- resume-question-generator upserts with onConflict: 'resume_claims_id', which
-- Postgres can only honour against a real unique constraint. Without one the
-- very first "Start assessment" fails with "no unique or exclusion constraint
-- matching the ON CONFLICT specification" — the resume path would have died on
-- its most important button.
--
-- One assessment per source is also the intended behaviour: a retake updates
-- the existing row, so created_at still holds the first attempt.
--
-- Plain UNIQUE rather than partial: Postgres treats nulls as distinct, so the
-- many rows with no resume (the skip path) do not collide with each other, and
-- the same holds the other way round.
-- ============================================================================

alter table public.resume_assessments
  add constraint resume_assessments_one_per_resume unique (resume_claims_id);

alter table public.resume_assessments
  add constraint resume_assessments_one_per_interest unique (student_interest_id);
