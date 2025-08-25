-- Fix RLS policies for student_profiles to allow college admins to create profiles
-- This is needed for CSV upload functionality

-- Drop existing policies that are too restrictive
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.student_profiles;
DROP POLICY IF EXISTS "College admins can manage student profiles" ON public.student_profiles;

-- Create new policies that allow college admins to manage all student profiles
-- and users to manage their own profiles
CREATE POLICY "College admins can manage all student profiles" 
ON public.student_profiles 
FOR ALL 
USING (has_role(auth.uid(), 'college_admin'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'college_admin'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can manage their own profile" 
ON public.student_profiles 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow public read access for portfolios and leaderboards
CREATE POLICY "Public can view student profiles for portfolios" 
ON public.student_profiles 
FOR SELECT 
USING (true);