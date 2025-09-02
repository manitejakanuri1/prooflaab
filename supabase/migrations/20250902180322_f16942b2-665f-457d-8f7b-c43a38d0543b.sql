-- Delete user records for test emails to allow re-signup
-- First delete from related tables to avoid constraint issues
DELETE FROM public.user_roles WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com')
);

DELETE FROM public.student_profiles WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com')
);

DELETE FROM public.college_profiles WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com')
);

DELETE FROM public.startup_profiles WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com')
);

DELETE FROM public.colleges WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com')
);

DELETE FROM public.startups WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com')
);

DELETE FROM public.students WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com')
);

-- Clear any email verification records
DELETE FROM public.email_verifications WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com');

DELETE FROM public.student_otps WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com');

DELETE FROM public.students_auth WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com');

-- Finally delete from auth.users (this should cascade to any remaining related records)
DELETE FROM auth.users WHERE email IN ('terracekisan@gmail.com', 'fittarang@gmail.com');