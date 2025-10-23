-- Create recruiter_links table
CREATE TABLE public.recruiter_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);

-- Create recruiter_link_views table for analytics
CREATE TABLE public.recruiter_link_views (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.recruiter_links(id) ON DELETE CASCADE,
  viewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ip_address INET
);

-- Enable RLS
ALTER TABLE public.recruiter_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiter_link_views ENABLE ROW LEVEL SECURITY;

-- RLS Policies for recruiter_links
CREATE POLICY "College admins can view their own links"
  ON public.recruiter_links
  FOR SELECT
  USING (
    college_id IN (
      SELECT id FROM public.colleges WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "College admins can create their own links"
  ON public.recruiter_links
  FOR INSERT
  WITH CHECK (
    college_id IN (
      SELECT id FROM public.colleges WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "College admins can update their own links"
  ON public.recruiter_links
  FOR UPDATE
  USING (
    college_id IN (
      SELECT id FROM public.colleges WHERE user_id = auth.uid()
    )
  );

-- Public can view active, non-expired links (for the public page)
CREATE POLICY "Public can view active links"
  ON public.recruiter_links
  FOR SELECT
  USING (
    status = 'active' AND expires_at > now()
  );

-- RLS Policies for recruiter_link_views
CREATE POLICY "Anyone can insert views"
  ON public.recruiter_link_views
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "College admins can view their link analytics"
  ON public.recruiter_link_views
  FOR SELECT
  USING (
    link_id IN (
      SELECT id FROM public.recruiter_links 
      WHERE college_id IN (
        SELECT id FROM public.colleges WHERE user_id = auth.uid()
      )
    )
  );

-- Create index for faster lookups
CREATE INDEX idx_recruiter_links_college_id ON public.recruiter_links(college_id);
CREATE INDEX idx_recruiter_links_status ON public.recruiter_links(status);
CREATE INDEX idx_recruiter_link_views_link_id ON public.recruiter_link_views(link_id);