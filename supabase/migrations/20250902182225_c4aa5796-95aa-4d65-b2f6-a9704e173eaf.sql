-- Clear all records for terracekisan@gmail.com for testing
-- Delete from user_roles first (has foreign key constraints)
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'terracekisan@gmail.com'
);

-- Delete from colleges table
DELETE FROM public.colleges 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'terracekisan@gmail.com'
);

-- Delete from students table
DELETE FROM public.students 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'terracekisan@gmail.com'
);

-- Delete from startups table
DELETE FROM public.startups 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'terracekisan@gmail.com'
);

-- Delete from college_profiles table
DELETE FROM public.college_profiles 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'terracekisan@gmail.com'
);

-- Delete from startup_profiles table
DELETE FROM public.startup_profiles 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'terracekisan@gmail.com'
);

-- Delete from auth.users table (this will cascade delete most other records)
DELETE FROM auth.users WHERE email = 'terracekisan@gmail.com';