-- Ensure the mock user has college_admin role properly assigned
INSERT INTO public.user_roles (user_id, role, has_completed_wizard)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'college_admin'::app_role, true)
ON CONFLICT (user_id, role) 
DO UPDATE SET has_completed_wizard = true;

-- Also create a college profile for this user
INSERT INTO public.college_profiles (
  user_id,
  college_name,
  location,
  student_strength,
  branches_offered
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Test College',
  'Test City',
  1000,
  ARRAY['Computer Science', 'Information Technology', 'Electronics']
) ON CONFLICT (user_id) DO NOTHING;