-- Product doc envisions 6 scores; only 3 (resume quality, ATS match, skill proof)
-- were ever surfaced as scorecard columns. Add the remaining 3 — the underlying
-- data (project-defense answers, confidence tags) already exists.
ALTER TABLE public.resume_scorecards
  ADD COLUMN project_proof_score numeric,
  ADD COLUMN reasoning_score numeric,
  ADD COLUMN interview_readiness_score numeric;
