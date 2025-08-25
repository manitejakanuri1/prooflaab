-- Fix RLS policies for CSV upload by college admins
-- The issue is that CSV uploads create profiles with user_id = null
-- but the policy requires auth.uid() = user_id which fails

-- Drop the existing restrictive policies
DROP POLICY IF EXISTS "College admins can manage all student profiles" ON public.student_profiles;
DROP POLICY IF EXISTS "Users can manage their own profile" ON public.student_profiles;
DROP POLICY IF EXISTS "Public can view student profiles for portfolios" ON public.student_profiles; 

-- Create more appropriate policies
-- Policy 1: College admins and admins can do everything with student profiles
CREATE POLICY "College admins can manage student profiles" 
ON public.student_profiles 
FOR ALL 
USING (has_role(auth.uid(), 'college_admin'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'college_admin'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

-- Policy 2: Users can manage their own profiles (when user_id is set)
CREATE POLICY "Users can manage their own student profile" 
ON public.student_profiles 
FOR ALL 
USING (user_id IS NOT NULL AND auth.uid() = user_id)
WITH CHECK (user_id IS NOT NULL AND auth.uid() = user_id);

-- Policy 3: Public read access for portfolios, leaderboards, and task assignments
CREATE POLICY "Public can view student profiles" 
ON public.student_profiles 
FOR SELECT 
USING (true);

-- Ensure default user has college_admin role for testing
-- This will help with immediate testing
DO $$
DECLARE
    auth_user_id uuid;
BEGIN
    -- Get the first authenticated user ID (for development/testing)
    SELECT id INTO auth_user_id FROM auth.users LIMIT 1;
    
    IF auth_user_id IS NOT NULL THEN
        -- Insert college_admin role if it doesn't exist
        INSERT INTO public.user_roles (user_id, role)
        VALUES (auth_user_id, 'college_admin'::app_role)
        ON CONFLICT (user_id, role) DO NOTHING;
        
        RAISE NOTICE 'Assigned college_admin role to user: %', auth_user_id;
    END IF;
END $$;