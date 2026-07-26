-- Resume-to-readiness, phase 2: turn a confirmed resume into questions, grade the
-- answers, and produce the 3 MVP scores (Resume Quality, ATS Match, Skill Proof).

ALTER TABLE public.resume_claims
  ADD COLUMN resume_quality_score numeric,
  ADD COLUMN resume_quality_notes text,
  ADD COLUMN ats_match_score numeric,
  ADD COLUMN ats_match_notes text;

CREATE TABLE public.resume_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_claims_id uuid NOT NULL UNIQUE REFERENCES public.resume_claims(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_scores jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'graded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resume_assessments_student_id ON public.resume_assessments(student_id);

ALTER TABLE public.resume_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage their own resume assessments"
ON public.resume_assessments FOR ALL
USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()))
WITH CHECK (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins and college admins can view resume assessments"
ON public.resume_assessments FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'college_admin'::app_role));

CREATE TRIGGER set_resume_assessments_updated_at
BEFORE UPDATE ON public.resume_assessments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- One row per graded attempt — the 3 MVP scores together, plus the roadmap text,
-- in one place the student (and later, college/recruiter views) can read from.
CREATE TABLE public.resume_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  resume_claims_id uuid NOT NULL REFERENCES public.resume_claims(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES public.resume_assessments(id) ON DELETE CASCADE,
  resume_quality_score numeric,
  ats_match_score numeric,
  skill_proof_score numeric,
  roadmap text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resume_scorecards_student_id ON public.resume_scorecards(student_id);

ALTER TABLE public.resume_scorecards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students view their own scorecards"
ON public.resume_scorecards FOR SELECT
USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins and college admins can view scorecards"
ON public.resume_scorecards FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'college_admin'::app_role));
