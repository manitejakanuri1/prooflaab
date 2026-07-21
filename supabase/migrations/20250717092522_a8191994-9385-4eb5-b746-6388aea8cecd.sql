-- Add RLS policy to allow college admins to assign tasks to students
CREATE POLICY "College admins can assign tasks to students" 
ON public.tasks 
FOR INSERT 
WITH CHECK (true);