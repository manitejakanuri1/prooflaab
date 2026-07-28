-- JD matching: student pastes a real job description, we compare it against
-- their confirmed resume claims instead of just an AI-inferred target role.

CREATE TABLE public.resume_jd_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  resume_claims_id uuid NOT NULL REFERENCES public.resume_claims(id) ON DELETE CASCADE,
  jd_text text NOT NULL,
  jd_title text,
  match_score numeric,
  matched_skills text[] NOT NULL DEFAULT '{}',
  missing_skills text[] NOT NULL DEFAULT '{}',
  suggestions text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resume_jd_matches_student_id ON public.resume_jd_matches(student_id);

ALTER TABLE public.resume_jd_matches ENABLE ROW LEVEL SECURITY;

-- Writes happen server-side only (edge function, service role) so a student
-- can't forge their own match score. Students can only read their own rows.
CREATE POLICY "Students view their own JD matches"
ON public.resume_jd_matches FOR SELECT
USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins and college admins can view JD matches"
ON public.resume_jd_matches FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'college_admin'::app_role));
