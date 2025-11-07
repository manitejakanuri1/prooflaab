-- Add missing columns to github_verifications
ALTER TABLE public.github_verifications
ADD COLUMN IF NOT EXISTS first_commit_at timestamptz,
ADD COLUMN IF NOT EXISTS largest_commit_delta integer,
ADD COLUMN IF NOT EXISTS authenticity_notes jsonb;

-- Rename last_commit_date to last_commit_at for consistency
ALTER TABLE public.github_verifications
RENAME COLUMN last_commit_date TO last_commit_at;

-- Add missing columns to ai_verifications
ALTER TABLE public.ai_verifications
ADD COLUMN IF NOT EXISTS ai_authorship_risk numeric,
ADD COLUMN IF NOT EXISTS explanation text,
ADD COLUMN IF NOT EXISTS raw_model_output jsonb;

-- Add missing columns to trust_scores
ALTER TABLE public.trust_scores
ADD COLUMN IF NOT EXISTS proof_id uuid REFERENCES public.proof_uploads(id),
ADD COLUMN IF NOT EXISTS commit_authenticity_score numeric,
ADD COLUMN IF NOT EXISTS ai_authorship_score numeric,
ADD COLUMN IF NOT EXISTS conceptual_understanding_score numeric,
ADD COLUMN IF NOT EXISTS cognitive_integrity_score numeric;

-- Create conceptual_tests table
CREATE TABLE IF NOT EXISTS public.conceptual_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id uuid NOT NULL REFERENCES public.proof_uploads(id) ON DELETE CASCADE,
  questions jsonb DEFAULT '[]'::jsonb,
  student_answers jsonb DEFAULT '[]'::jsonb,
  answer_scores jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_github_verifications_proof_id ON public.github_verifications(proof_id);
CREATE INDEX IF NOT EXISTS idx_ai_verifications_proof_id ON public.ai_verifications(proof_id);
CREATE INDEX IF NOT EXISTS idx_conceptual_tests_proof_id ON public.conceptual_tests(proof_id);
CREATE INDEX IF NOT EXISTS idx_trust_scores_student_id ON public.trust_scores(student_id);
CREATE INDEX IF NOT EXISTS idx_trust_scores_proof_id ON public.trust_scores(proof_id);

-- Enable RLS on conceptual_tests
ALTER TABLE public.conceptual_tests ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for conceptual_tests
CREATE POLICY "Admins and colleges can manage conceptual tests"
ON public.conceptual_tests
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'college_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'college_admin'::app_role));

CREATE POLICY "Students can view and update their own conceptual tests"
ON public.conceptual_tests
FOR SELECT
USING (proof_id IN (
  SELECT id FROM public.proof_uploads 
  WHERE student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  )
));

CREATE POLICY "Students can update their own conceptual test answers"
ON public.conceptual_tests
FOR UPDATE
USING (proof_id IN (
  SELECT id FROM public.proof_uploads 
  WHERE student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  )
));