-- Follow-up to the user-deletion fix. The cascade it enabled runs one level
-- further than that migration reached, and hit four more NO ACTION keys, so the
-- earlier fix only appeared to work because the test accounts had no proofs or
-- tasks. A real student would still have failed to delete.

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

ALTER TABLE public.task_assignments DROP CONSTRAINT IF EXISTS fk_task_assignments_task;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT fk_task_assignments_task
  FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;

-- A student outlives their college being removed; they stop belonging to one.
-- Cascading would delete students as a side effect of tidying a college record,
-- which is never what that action means.
ALTER TABLE public.student_profiles DROP CONSTRAINT IF EXISTS student_profiles_college_id_fkey;
ALTER TABLE public.student_profiles
  ADD CONSTRAINT student_profiles_college_id_fkey
  FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE SET NULL;

-- tasks.visibility defaulted to 'private', but the table's own check constraint
-- permits only 'public' or 'restricted'. Every insert that did not name a
-- visibility was rejected by the table it was inserting into.
--
-- Two callers never set it: assign_tasks, and the roadmap-to-tasks step in
-- resume-assessment-submit. The latter only logs the failure, so every student
-- who finished an assessment got a roadmap and silently got none of the tasks it
-- was supposed to create.
--
-- 'restricted' rather than widening the constraint to accept 'private': the
-- constraint is the deliberate statement of what the column means, and
-- 'restricted' already carries the not-public sense the default intended.
ALTER TABLE public.tasks ALTER COLUMN visibility SET DEFAULT 'restricted';

UPDATE public.tasks SET visibility = 'restricted'
WHERE visibility IS NULL OR visibility NOT IN ('public', 'restricted');
