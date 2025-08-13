-- Clean up test user accounts but keep admin/developer accounts
-- Delete from related tables first due to foreign key constraints

-- Delete user roles for test accounts (keep admin accounts)
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  LEFT JOIN public.user_roles ur ON au.id = ur.user_id
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete student profiles for test accounts
DELETE FROM public.student_profiles 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete startup profiles for test accounts
DELETE FROM public.startups 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete college profiles for test accounts
DELETE FROM public.colleges 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);

-- Delete other related data
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

DELETE FROM public.activity_logs 
WHERE user_id IN (
  SELECT au.id 
  FROM auth.users au 
  WHERE au.email NOT LIKE '%admin%' 
  AND au.email NOT LIKE '%developer%'
  AND au.email != 'prooflabai.project@gmail.com'
  AND au.created_at >= '2025-07-01'
);