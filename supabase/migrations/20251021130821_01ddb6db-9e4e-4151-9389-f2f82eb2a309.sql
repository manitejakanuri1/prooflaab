-- Add RLS policy to allow students to view public, approved tasks
CREATE POLICY "Students can view public approved tasks"
ON public.tasks
FOR SELECT
USING (
  visibility = 'public' 
  AND approved_by_admin = true 
  AND student_id IS NULL
);