-- Certification radar: suggest certs worth pursuing next for the student's
-- target role, given what they already claim to have.

CREATE TABLE public.resume_cert_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  resume_claims_id uuid NOT NULL REFERENCES public.resume_claims(id) ON DELETE CASCADE,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resume_cert_suggestions_student_id ON public.resume_cert_suggestions(student_id);

ALTER TABLE public.resume_cert_suggestions ENABLE ROW LEVEL SECURITY;

-- Writes happen server-side only (edge function, service role).
CREATE POLICY "Students view their own cert suggestions"
ON public.resume_cert_suggestions FOR SELECT
USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins and college admins can view cert suggestions"
ON public.resume_cert_suggestions FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'college_admin'::app_role));
