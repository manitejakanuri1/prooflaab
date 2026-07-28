-- Tiered resume feedback: when a resume already scores "excellent" on ATS match,
-- skip the rewrite offer and instead judge whether the claimed skills/certs are
-- actually valuable, with suggestions on what to do next.

ALTER TABLE public.resume_claims
  ADD COLUMN skill_relevance_notes text;
