-- Update RLS policies to allow students to delete their own notifications
DROP POLICY IF EXISTS "Students can delete their own notifications" ON notifications;

CREATE POLICY "Students can delete their own notifications" 
ON notifications 
FOR DELETE 
USING (student_id IN ( SELECT student_profiles.id
   FROM student_profiles
  WHERE (student_profiles.user_id = auth.uid())));