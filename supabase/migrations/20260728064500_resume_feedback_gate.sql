-- Resume feedback gate: show ATS/quality score + notes right after upload, before
-- the student confirms skills/certs/projects. Student can ask AI to rewrite the
-- resume based on the flaws found, or just acknowledge and move on.

ALTER TABLE public.resume_claims
  ADD COLUMN feedback_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN ai_improved_resume text;
