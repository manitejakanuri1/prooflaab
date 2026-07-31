-- Role-specific skill gap: verified/needs_improvement/missing skills for the
-- student's target role, computed alongside the roadmap. Null when the target
-- role isn't one of the known roles in the required-skills lookup.
ALTER TABLE public.resume_scorecards
  ADD COLUMN skill_gap jsonb;
