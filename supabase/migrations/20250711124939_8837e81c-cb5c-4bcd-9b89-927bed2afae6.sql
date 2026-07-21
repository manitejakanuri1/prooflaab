
-- Allow students to insert tasks (for this demo, we'll allow self-assignment)
-- In a real application, this would typically be done by an admin/teacher
CREATE POLICY "Students can insert their own tasks" ON public.tasks
  FOR INSERT 
  WITH CHECK (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

-- Also allow students to update their own tasks (for status changes)
CREATE POLICY "Students can update their own tasks" ON public.tasks
  FOR UPDATE 
  USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));
