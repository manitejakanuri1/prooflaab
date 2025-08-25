-- Clean up existing student test data
DELETE FROM public.student_profiles 
WHERE email IN ('info.yuvasakhi@gmail.com', 'vidyuthsetu@gmail.com');

-- Clean up any related records
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT id FROM auth.users 
  WHERE email IN ('info.yuvasakhi@gmail.com', 'vidyuthsetu@gmail.com')
);

-- Note: Auth users will need to be deleted manually from Supabase dashboard
-- as we cannot delete auth.users from SQL for security reasons