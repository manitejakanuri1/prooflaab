-- Resume-to-readiness, phase 1: upload a resume, extract skills/certs/projects/target role via AI,
-- hold them for the student to confirm/edit before any assessment is generated from them.

-- Private bucket for the raw resume file (separate from student_profiles.resume_url, which is a
-- public download link recruiters use — this bucket is only for parsing, never public).
INSERT INTO storage.buckets (id, name, public)
VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Students can upload their own resume file"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Students can view their own resume file"
ON storage.objects FOR SELECT
USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Students can replace their own resume file"
ON storage.objects FOR UPDATE
USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Students can delete their own resume file"
ON storage.objects FOR DELETE
USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE TABLE public.resume_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  target_role text,
  skills text[] NOT NULL DEFAULT '{}',
  certifications text[] NOT NULL DEFAULT '{}',
  projects jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_extraction jsonb,
  status text NOT NULL DEFAULT 'extracted' CHECK (status IN ('extracted', 'confirmed')),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resume_claims_student_id ON public.resume_claims(student_id);

ALTER TABLE public.resume_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage their own resume claims"
ON public.resume_claims FOR ALL
USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()))
WITH CHECK (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins and college admins can view resume claims"
ON public.resume_claims FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'college_admin'::app_role));

CREATE TRIGGER set_resume_claims_updated_at
BEFORE UPDATE ON public.resume_claims
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
