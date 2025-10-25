-- Create table for GitHub verifications
CREATE TABLE public.github_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id UUID NOT NULL REFERENCES public.proof_uploads(id) ON DELETE CASCADE,
  repo_url TEXT,
  commit_count INTEGER DEFAULT 0,
  last_commit_date TIMESTAMPTZ,
  unique_contributors INTEGER DEFAULT 0,
  authenticity_score NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create table for AI verifications
CREATE TABLE public.ai_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id UUID NOT NULL REFERENCES public.proof_uploads(id) ON DELETE CASCADE,
  ai_summary TEXT,
  originality_score NUMERIC(5,2),
  ai_comments TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.github_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_verifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for github_verifications
CREATE POLICY "Admins and colleges can view github verifications"
ON public.github_verifications FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'college_admin'::app_role)
);

CREATE POLICY "Admins and colleges can insert github verifications"
ON public.github_verifications FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'college_admin'::app_role)
);

-- RLS Policies for ai_verifications
CREATE POLICY "Admins and colleges can view ai verifications"
ON public.ai_verifications FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'college_admin'::app_role)
);

CREATE POLICY "Admins and colleges can insert ai verifications"
ON public.ai_verifications FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'college_admin'::app_role)
);

-- Create indexes for better performance
CREATE INDEX idx_github_verifications_proof_id ON public.github_verifications(proof_id);
CREATE INDEX idx_ai_verifications_proof_id ON public.ai_verifications(proof_id);