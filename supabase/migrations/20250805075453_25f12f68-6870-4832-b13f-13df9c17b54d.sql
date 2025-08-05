-- Add columns to tasks table to support startup-posted tasks
ALTER TABLE public.tasks ADD COLUMN created_by_startup_id UUID;
ALTER TABLE public.tasks ADD COLUMN is_paid BOOLEAN DEFAULT false;
ALTER TABLE public.tasks ADD COLUMN required_skills TEXT[];
ALTER TABLE public.tasks ADD COLUMN posted_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Make student_id nullable for startup-posted tasks (not assigned to specific student yet)
ALTER TABLE public.tasks ALTER COLUMN student_id DROP NOT NULL;

-- Add RLS policy for startups to manage their posted tasks
CREATE POLICY "Startups can insert their own tasks" 
ON public.tasks 
FOR INSERT 
WITH CHECK (created_by_startup_id = auth.uid());

CREATE POLICY "Startups can view their own tasks" 
ON public.tasks 
FOR SELECT 
USING (created_by_startup_id = auth.uid());

CREATE POLICY "Startups can update their own tasks" 
ON public.tasks 
FOR UPDATE 
USING (created_by_startup_id = auth.uid());