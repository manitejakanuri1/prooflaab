-- Public-safe view: latest resume scorecard per student, only for students with a public portfolio.
-- Excludes voice_notes/voice_authenticity_score (private per product principle: explanation
-- transcripts stay private unless student opts in). Base resume_scorecards table RLS is unchanged.
CREATE VIEW public.public_resume_scorecards AS
SELECT DISTINCT ON (rs.student_id)
  rs.student_id,
  rs.resume_quality_score,
  rs.ats_match_score,
  rs.skill_proof_score,
  rs.project_proof_score,
  rs.reasoning_score,
  rs.interview_readiness_score,
  rs.roadmap,
  rs.created_at
FROM public.resume_scorecards rs
JOIN public.student_portfolios sp ON sp.student_id = rs.student_id AND sp.is_public = true
ORDER BY rs.student_id, rs.created_at DESC;

GRANT SELECT ON public.public_resume_scorecards TO anon, authenticated;
