
-- Create student_portfolios table
CREATE TABLE IF NOT EXISTS public.student_portfolios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  public_url_slug TEXT NOT NULL UNIQUE,
  bio TEXT,
  skills TEXT[], -- Array of skill strings
  achievements TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add unique constraint to ensure one portfolio per student
ALTER TABLE public.student_portfolios ADD CONSTRAINT unique_student_portfolio UNIQUE (student_id);

-- Create index on public_url_slug for faster lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_slug ON public.student_portfolios(public_url_slug);

-- Enable Row Level Security
ALTER TABLE public.student_portfolios ENABLE ROW LEVEL SECURITY;

-- Policy for users to view their own portfolio
CREATE POLICY "Users can view their own portfolio" 
  ON public.student_portfolios 
  FOR SELECT 
  USING (student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  ));

-- Policy for users to update their own portfolio
CREATE POLICY "Users can update their own portfolio" 
  ON public.student_portfolios 
  FOR UPDATE 
  USING (student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  ));

-- Policy for users to insert their own portfolio
CREATE POLICY "Users can insert their own portfolio" 
  ON public.student_portfolios 
  FOR INSERT 
  WITH CHECK (student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  ));

-- Policy for public access to portfolios when is_public is true
CREATE POLICY "Public can view public portfolios" 
  ON public.student_portfolios 
  FOR SELECT 
  USING (is_public = true);

-- Function to generate URL slug from student name
CREATE OR REPLACE FUNCTION generate_url_slug(student_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN lower(replace(trim(student_name), ' ', '-'));
END;
$$;

-- Create portfolios for existing students
INSERT INTO public.student_portfolios (student_id, public_url_slug, bio, skills, is_public)
SELECT 
  sp.id,
  generate_url_slug(sp.full_name),
  'Passionate student building skills through hands-on projects and real-world tasks.',
  ARRAY['Problem Solving', 'Team Collaboration', 'Technical Skills'],
  true
FROM public.student_profiles sp
WHERE sp.id NOT IN (SELECT student_id FROM public.student_portfolios);
