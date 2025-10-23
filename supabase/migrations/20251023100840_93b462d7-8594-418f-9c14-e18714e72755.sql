-- Fix RLS policies for task_assignments table to work with student_profiles

-- Drop existing policies
DROP POLICY IF EXISTS "Students can view their own assignments" ON public.task_assignments;
DROP POLICY IF EXISTS "Students can update their own assignment status" ON public.task_assignments;
DROP POLICY IF EXISTS "Admins and Colleges can insert assignments" ON public.task_assignments;

-- Create correct policies that use student_profiles.id instead of auth.uid()
CREATE POLICY "Students can view their own assignments"
ON public.task_assignments
FOR SELECT
USING (
  student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Students can update their own assignments"
ON public.task_assignments
FOR UPDATE
USING (
  student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Admins and Colleges can manage assignments"
ON public.task_assignments
FOR ALL
USING (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'college_admin'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR 
  has_role(auth.uid(), 'college_admin'::app_role)
);

-- Allow startups to view assignments for their tasks
CREATE POLICY "Startups can view assignments for their tasks"
ON public.task_assignments
FOR SELECT
USING (
  task_id IN (
    SELECT id FROM public.tasks WHERE created_by_startup_id = auth.uid()
  )
);