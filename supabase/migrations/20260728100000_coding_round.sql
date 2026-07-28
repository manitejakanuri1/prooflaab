-- Real coding exercises: after the MCQ/short-answer quiz and voice defense,
-- the student writes actual runnable code for 2 problems in their claimed
-- language, executed in a sandboxed runner and graded against test cases.

ALTER TABLE public.resume_assessments
  ADD COLUMN coding_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN coding_results jsonb;

ALTER TABLE public.resume_scorecards
  ADD COLUMN coding_score numeric;
