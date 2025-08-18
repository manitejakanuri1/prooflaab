-- Fix authentication issues: Add RLS policies and update domain

-- First, let's ensure the user_roles table has proper RLS policies
DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to insert roles during signup" ON public.user_roles;

-- Create RLS policies for user_roles table
CREATE POLICY "Users can read their own roles" 
ON public.user_roles 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Allow authenticated users to insert roles during signup" 
ON public.user_roles 
FOR INSERT 
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Also ensure invite_codes has proper policies
DROP POLICY IF EXISTS "Allow authenticated users to insert invite codes" ON public.invite_codes;
CREATE POLICY "Allow authenticated users to insert invite codes" 
ON public.invite_codes 
FOR INSERT 
TO authenticated
WITH CHECK (created_by = auth.uid());

-- Ensure student_profiles has proper policies
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.student_profiles;
CREATE POLICY "Users can insert their own profile" 
ON public.student_profiles 
FOR INSERT 
TO authenticated
WITH CHECK (user_id = auth.uid());