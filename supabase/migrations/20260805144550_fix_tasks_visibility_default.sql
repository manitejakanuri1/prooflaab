-- tasks.visibility defaulted to 'private', but the table's own check constraint
-- permits only 'public' or 'restricted'. Every insert that did not name a
-- visibility was therefore rejected by the table it was inserting into.
--
-- Two callers never set it: assign_tasks, and the roadmap-to-tasks step in
-- resume-assessment-submit. The latter only logs the failure, so every student
-- who finished an assessment got a roadmap and silently got none of the tasks
-- it was supposed to create.
--
-- 'restricted' rather than widening the constraint to accept 'private': the
-- constraint is the deliberate statement of what the column means, and
-- 'restricted' already carries the not-public sense the default intended.

ALTER TABLE public.tasks ALTER COLUMN visibility SET DEFAULT 'restricted';

-- Any row that predates the constraint and still holds the invalid value.
UPDATE public.tasks SET visibility = 'restricted'
WHERE visibility IS NULL OR visibility NOT IN ('public', 'restricted');;
