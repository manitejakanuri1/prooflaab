-- Create learning_resources table
CREATE TABLE IF NOT EXISTS public.learning_resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  platform TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'ALL',
  category TEXT,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create job_opportunities table
CREATE TABLE IF NOT EXISTS public.job_opportunities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role TEXT NOT NULL,
  company_name TEXT NOT NULL,
  logo_url TEXT,
  location TEXT NOT NULL,
  job_type TEXT NOT NULL,
  eligible_branch TEXT NOT NULL DEFAULT 'ALL',
  apply_link TEXT NOT NULL,
  deadline DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_opportunities ENABLE ROW LEVEL SECURITY;

-- Create policies for learning_resources
CREATE POLICY "Students can view all learning resources" 
ON public.learning_resources 
FOR SELECT 
USING (true);

CREATE POLICY "Admins can insert learning resources" 
ON public.learning_resources 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Admins can update learning resources" 
ON public.learning_resources 
FOR UPDATE 
USING (true);

CREATE POLICY "Admins can delete learning resources" 
ON public.learning_resources 
FOR DELETE 
USING (true);

-- Create policies for job_opportunities
CREATE POLICY "Students can view all job opportunities" 
ON public.job_opportunities 
FOR SELECT 
USING (true);

CREATE POLICY "Admins can insert job opportunities" 
ON public.job_opportunities 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Admins can update job opportunities" 
ON public.job_opportunities 
FOR UPDATE 
USING (true);

CREATE POLICY "Admins can delete job opportunities" 
ON public.job_opportunities 
FOR DELETE 
USING (true);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_learning_resources_branch ON public.learning_resources(branch);
CREATE INDEX IF NOT EXISTS idx_learning_resources_platform ON public.learning_resources(platform);
CREATE INDEX IF NOT EXISTS idx_learning_resources_is_premium ON public.learning_resources(is_premium);

CREATE INDEX IF NOT EXISTS idx_job_opportunities_job_type ON public.job_opportunities(job_type);
CREATE INDEX IF NOT EXISTS idx_job_opportunities_eligible_branch ON public.job_opportunities(eligible_branch);
CREATE INDEX IF NOT EXISTS idx_job_opportunities_deadline ON public.job_opportunities(deadline);