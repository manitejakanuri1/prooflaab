-- Temporarily disable the task validation trigger
DROP TRIGGER IF EXISTS validate_task_trigger ON public.tasks;

-- Clean up all dependent data first
DELETE FROM public.xp_logs 
WHERE student_id IN (
  SELECT sp.id 
  FROM public.student_profiles sp
  JOIN auth.users au ON sp.user_id = au.id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

DELETE FROM public.trust_scores 
WHERE student_id IN (
  SELECT sp.id 
  FROM public.student_profiles sp
  JOIN auth.users au ON sp.user_id = au.id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

DELETE FROM public.student_portfolios 
WHERE student_id IN (
  SELECT sp.id 
  FROM public.student_profiles sp
  JOIN auth.users au ON sp.user_id = au.id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Update tasks to remove student assignments
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

-- Recreate the validation trigger
CREATE TRIGGER validate_task_trigger
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.validate_task();