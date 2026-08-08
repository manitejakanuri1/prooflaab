-- The earlier pass fixed the keys pointing at auth.users and student_profiles,
-- but the cascade it enabled runs one level further and hit four more NO ACTION
-- keys. Deleting a student cascades into their tasks and proofs, and those were
-- still blocked — so the fix only appeared to work because the test accounts had
-- no proofs or tasks yet. A real student would have failed.

-- A trust score is a measurement of one proof and means nothing without it.
ALTER TABLE public.trust_scores DROP CONSTRAINT IF EXISTS trust_scores_proof_id_fkey;
ALTER TABLE public.trust_scores
  ADD CONSTRAINT trust_scores_proof_id_fkey
  FOREIGN KEY (proof_id) REFERENCES public.proof_uploads(id) ON DELETE CASCADE;

-- task_id is NOT NULL: a proof exists to answer a task, so there is no coherent
-- state where the task is gone and the proof remains.
ALTER TABLE public.proof_uploads DROP CONSTRAINT IF EXISTS proof_uploads_task_id_fkey;
ALTER TABLE public.proof_uploads
  ADD CONSTRAINT proof_uploads_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

-- An assignment of a task that no longer exists is not worth keeping.
ALTER TABLE public.task_assignments DROP CONSTRAINT IF EXISTS fk_task_assignments_task;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT fk_task_assignments_task
  FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

-- A student outlives their college being removed; they simply stop belonging to
-- one. Cascading here would delete students as a side effect of tidying up a
-- college record, which is never what that action means.
ALTER TABLE public.student_profiles DROP CONSTRAINT IF EXISTS student_profiles_college_id_fkey;
ALTER TABLE public.student_profiles
  ADD CONSTRAINT student_profiles_college_id_fkey
  FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE SET NULL;;
