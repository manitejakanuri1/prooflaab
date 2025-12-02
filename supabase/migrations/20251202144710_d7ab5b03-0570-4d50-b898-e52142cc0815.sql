-- Create post_engagements table for tracking recruiter analytics
CREATE TABLE public.post_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.proof_posts(id) ON DELETE CASCADE,
  post_owner_id uuid NOT NULL,
  viewer_id uuid,
  viewer_type text NOT NULL CHECK (viewer_type IN ('guest', 'student', 'recruiter')),
  engagement_type text NOT NULL CHECK (engagement_type IN ('view', 'email_click', 'linkedin_click', 'github_click', 'resume_click')),
  created_at timestamptz NOT NULL DEFAULT now(),
  viewer_ip_hash text,
  user_agent text
);

-- Create indexes for performance
CREATE INDEX idx_post_engagements_post_id ON public.post_engagements(post_id);
CREATE INDEX idx_post_engagements_post_owner_id ON public.post_engagements(post_owner_id);
CREATE INDEX idx_post_engagements_engagement_type ON public.post_engagements(engagement_type);
CREATE INDEX idx_post_engagements_created_at ON public.post_engagements(created_at);

-- Enable RLS
ALTER TABLE public.post_engagements ENABLE ROW LEVEL SECURITY;

-- Allow anyone (anon + authenticated) to insert engagements
CREATE POLICY "Anyone can insert engagements"
ON public.post_engagements
FOR INSERT
WITH CHECK (true);

-- Only post owners can view their own engagement data
CREATE POLICY "Post owners can view their engagements"
ON public.post_engagements
FOR SELECT
USING (post_owner_id = auth.uid());

-- Create RPC to get engagement summary
CREATE OR REPLACE FUNCTION public.get_post_engagement_summary(p_post_id uuid)
RETURNS TABLE (
  views_count bigint,
  email_clicks bigint,
  linkedin_clicks bigint,
  github_clicks bigint,
  resume_clicks bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE engagement_type = 'view') as views_count,
    COUNT(*) FILTER (WHERE engagement_type = 'email_click') as email_clicks,
    COUNT(*) FILTER (WHERE engagement_type = 'linkedin_click') as linkedin_clicks,
    COUNT(*) FILTER (WHERE engagement_type = 'github_click') as github_clicks,
    COUNT(*) FILTER (WHERE engagement_type = 'resume_click') as resume_clicks
  FROM public.post_engagements
  WHERE post_id = p_post_id
    AND post_owner_id = auth.uid();
$$;