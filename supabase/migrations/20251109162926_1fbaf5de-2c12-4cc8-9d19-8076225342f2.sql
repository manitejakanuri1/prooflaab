-- Add appeals system table
CREATE TABLE IF NOT EXISTS public.proof_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id UUID NOT NULL REFERENCES proof_uploads(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  appeal_reason TEXT NOT NULL,
  appeal_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID,
  reviewer_decision TEXT,
  reviewer_comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMP WITH TIME ZONE
);

-- Add verification settings table for colleges
CREATE TABLE IF NOT EXISTS public.verification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  min_trust_score INTEGER NOT NULL DEFAULT 10,
  min_conceptual_score INTEGER NOT NULL DEFAULT 30,
  min_ai_likelihood INTEGER NOT NULL DEFAULT 50,
  min_authenticity_score INTEGER NOT NULL DEFAULT 40,
  auto_approve_threshold INTEGER NOT NULL DEFAULT 70,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(college_id)
);

-- Enable RLS
ALTER TABLE public.proof_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for proof_appeals
CREATE POLICY "Students can insert their own appeals"
  ON public.proof_appeals FOR INSERT
  WITH CHECK (
    student_id IN (
      SELECT id FROM student_profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Students can view their own appeals"
  ON public.proof_appeals FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM student_profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "College admins can view appeals from their students"
  ON public.proof_appeals FOR SELECT
  USING (
    student_id IN (
      SELECT sp.id FROM student_profiles sp
      JOIN colleges c ON sp.college_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "College admins can update appeals from their students"
  ON public.proof_appeals FOR UPDATE
  USING (
    student_id IN (
      SELECT sp.id FROM student_profiles sp
      JOIN colleges c ON sp.college_id = c.id
      WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all appeals"
  ON public.proof_appeals FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for verification_settings
CREATE POLICY "College admins can manage their settings"
  ON public.verification_settings FOR ALL
  USING (
    college_id IN (
      SELECT id FROM colleges WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    college_id IN (
      SELECT id FROM colleges WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all settings"
  ON public.verification_settings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Create indexes
CREATE INDEX idx_proof_appeals_proof_id ON public.proof_appeals(proof_id);
CREATE INDEX idx_proof_appeals_student_id ON public.proof_appeals(student_id);
CREATE INDEX idx_proof_appeals_status ON public.proof_appeals(appeal_status);
CREATE INDEX idx_verification_settings_college_id ON public.verification_settings(college_id);