-- Server-side timing for the quiz.
--
-- The 15-second-per-question limit was counted only in the browser, and the
-- submit endpoint accepted answers whenever they arrived. Anyone could pause,
-- look things up, and answer an hour later. created_at could not stand in for a
-- start time: the assessment row is upserted on resume_claims_id, so a retake
-- keeps the original creation timestamp.

ALTER TABLE public.resume_assessments
  ADD COLUMN IF NOT EXISTS started_at      timestamptz,
  ADD COLUMN IF NOT EXISTS elapsed_seconds integer;

-- Backfill so existing pending assessments are not judged against a null start.
UPDATE public.resume_assessments
SET started_at = COALESCE(updated_at, created_at)
WHERE started_at IS NULL;;
