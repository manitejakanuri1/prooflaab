-- Add created_by field to job_opportunities table to track which startup posted the job
ALTER TABLE public.job_opportunities 
ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_job_opportunities_created_by ON public.job_opportunities(created_by);

-- Update RLS policies for job_opportunities
DROP POLICY IF EXISTS "Startups can insert their own jobs" ON public.job_opportunities;
DROP POLICY IF EXISTS "Startups can update their own jobs" ON public.job_opportunities;
DROP POLICY IF EXISTS "Startups can view their own jobs" ON public.job_opportunities;

-- Startups can insert their own jobs
CREATE POLICY "Startups can insert their own jobs"
ON public.job_opportunities
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid() AND 
  has_role(auth.uid(), 'startup'::app_role)
);

-- Startups can update their own jobs
CREATE POLICY "Startups can update their own jobs"
ON public.job_opportunities
FOR UPDATE
TO authenticated
USING (created_by = auth.uid() AND has_role(auth.uid(), 'startup'::app_role));

-- Startups can view their own jobs
CREATE POLICY "Startups can view their own jobs"
ON public.job_opportunities
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid() AND 
  has_role(auth.uid(), 'startup'::app_role)
);