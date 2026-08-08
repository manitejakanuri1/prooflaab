-- task_assignments carried the same uniqueness twice:
--   task_assignments_task_id_student_id_key
--   task_assignments_unique_student_task
-- Identical column pairs, so Postgres maintained two identical B-trees on every
-- insert and update. Keep the first; the second was pure write cost.

ALTER TABLE public.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_unique_student_task;
