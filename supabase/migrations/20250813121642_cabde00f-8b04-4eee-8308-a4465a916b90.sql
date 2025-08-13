-- Now clean up the remaining data
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

DELETE FROM public.notifications 
WHERE student_id IN (
  SELECT sp.id 
  FROM public.student_profiles sp
  JOIN auth.users au ON sp.user_id = au.id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete user roles for test accounts
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete profiles
DELETE FROM public.student_profiles 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

DELETE FROM public.startups 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

DELETE FROM public.colleges 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);