
-- Add missing columns to tasks table
ALTER TABLE public.tasks 
ADD COLUMN xp INTEGER DEFAULT 0,
ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;

-- Update some existing tasks with sample data for testing
UPDATE public.tasks 
SET 
  xp = (RANDOM() * 100 + 25)::INTEGER,
  completed_at = CASE 
    WHEN status = 'Completed' THEN NOW() - (RANDOM() * INTERVAL '30 days')
    ELSE NULL
  END
WHERE id IN (SELECT id FROM public.tasks LIMIT 10);
