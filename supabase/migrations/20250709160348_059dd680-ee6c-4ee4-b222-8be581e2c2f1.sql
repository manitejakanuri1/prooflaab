
-- Create trust_scores table
CREATE TABLE public.trust_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add unique constraint to ensure one trust score per student
ALTER TABLE public.trust_scores ADD CONSTRAINT unique_student_trust_score UNIQUE (student_id);

-- Enable Row Level Security
ALTER TABLE public.trust_scores ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view their own trust score
CREATE POLICY "Users can view their own trust score" 
  ON public.trust_scores 
  FOR SELECT 
  USING (student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  ));

-- Create policy for users to update their own trust score (for future automation)
CREATE POLICY "Users can update their own trust score" 
  ON public.trust_scores 
  FOR UPDATE 
  USING (student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  ));

-- Create policy for inserting trust scores
CREATE POLICY "Users can insert their own trust score" 
  ON public.trust_scores 
  FOR INSERT 
  WITH CHECK (student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  ));

-- Insert some sample trust scores for existing students (optional)
INSERT INTO public.trust_scores (student_id, score)
SELECT id, 
  CASE 
    WHEN total_xp >= 2000 THEN 85
    WHEN total_xp >= 1000 THEN 70
    WHEN total_xp >= 500 THEN 55
    ELSE 30
  END as calculated_score
FROM public.student_profiles
WHERE id NOT IN (SELECT student_id FROM public.trust_scores);
