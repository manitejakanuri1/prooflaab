-- First, let's clean up tasks and related data that reference student profiles
-- Update tasks to remove student assignments for test accounts
UPDATE public.tasks 
SET student_id = NULL 
WHERE student_id IN (
  SELECT sp.id 
  FROM public.student_profiles sp
  JOIN auth.users au ON sp.user_id = au.id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete task applications for test accounts
DELETE FROM public.task_applications 
WHERE student_id IN (
  SELECT sp.id 
  FROM public.student_profiles sp
  JOIN auth.users au ON sp.user_id = au.id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete proof uploads for test accounts
DELETE FROM public.proof_uploads 
WHERE student_id IN (
  SELECT sp.id 
  FROM public.student_profiles sp
  JOIN auth.users au ON sp.user_id = au.id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);