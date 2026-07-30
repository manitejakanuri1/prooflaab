-- Retest system: lets a student retake only the questions they scored weak on,
-- generated fresh (not verbatim repeats) so the flag exists to distinguish a
-- targeted weak-topic retest from a full retake in the history view.

ALTER TABLE public.resume_assessments
  ADD COLUMN is_retest boolean NOT NULL DEFAULT false;

ALTER TABLE public.resume_scorecards
  ADD COLUMN is_retest boolean NOT NULL DEFAULT false;
