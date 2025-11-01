-- Fix existing tasks that were created by colleges but marked as admin
-- First, let's update tasks that have a college assignment pattern
-- (student_id is set and created_by_college_id should be inferred from student's college)

UPDATE tasks
SET 
  created_by_type = 'college',
  created_by_college_id = sp.college_id
FROM student_profiles sp
WHERE 
  tasks.student_id = sp.id 
  AND tasks.created_by_type = 'admin'
  AND tasks.created_by_college_id IS NULL
  AND sp.college_id IS NOT NULL;