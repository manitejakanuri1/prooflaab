
-- Create xp_logs table to track XP earned by students
CREATE TABLE IF NOT EXISTS public.xp_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES public.student_profiles(id) NOT NULL,
  xp_points INTEGER NOT NULL,
  source TEXT, -- Optional: track where XP came from (task completion, bonus, etc.)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on xp_logs table
ALTER TABLE public.xp_logs ENABLE ROW LEVEL SECURITY;

-- Create policy that allows users to view their own XP logs
CREATE POLICY "Users can view their own XP logs" 
  ON public.xp_logs 
  FOR SELECT 
  USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

-- Create policy that allows inserting XP logs for authenticated users
CREATE POLICY "Users can insert XP logs" 
  ON public.xp_logs 
  FOR INSERT 
  WITH CHECK (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

-- Add some sample data for testing (optional)
INSERT INTO public.xp_logs (student_id, xp_points, source, created_at) 
SELECT 
  sp.id,
  (RANDOM() * 100 + 50)::INTEGER,
  CASE (RANDOM() * 3)::INTEGER
    WHEN 0 THEN 'Task Completion'
    WHEN 1 THEN 'Bonus Points'
    ELSE 'Achievement'
  END,
  NOW() - (RANDOM() * INTERVAL '30 days')
FROM public.student_profiles sp
LIMIT 20;
