-- Allow students to insert task assignments when they start tasks
CREATE POLICY "Students can insert their own task assignments"
ON task_assignments
FOR INSERT
WITH CHECK (
  student_id IN (
    SELECT id FROM student_profiles WHERE user_id = auth.uid()
  )
);