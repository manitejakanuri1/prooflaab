-- Fix RLS policies to allow initial user creation during signup

-- Drop existing restrictive policies on user_roles
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can update their own role" ON public.user_roles;

-- Create more permissive policies for user_roles that allow signup
CREATE POLICY "Allow authenticated users to insert their own role" 
ON public.user_roles 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to view their own role" 
ON public.user_roles 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to update their own role" 
ON public.user_roles 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id);

-- Fix policies for colleges table
DROP POLICY IF EXISTS "Users can insert their own college" ON public.colleges;
DROP POLICY IF EXISTS "Users can view their own college" ON public.colleges;
DROP POLICY IF EXISTS "Users can update their own college" ON public.colleges;

CREATE POLICY "Allow authenticated users to insert their own college" 
ON public.colleges 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to view their own college" 
ON public.colleges 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to update their own college" 
ON public.colleges 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id);

-- Fix policies for startups table
DROP POLICY IF EXISTS "Users can insert their own startup" ON public.startups;
DROP POLICY IF EXISTS "Users can view their own startup" ON public.startups;
DROP POLICY IF EXISTS "Users can update their own startup" ON public.startups;

CREATE POLICY "Allow authenticated users to insert their own startup" 
ON public.startups 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to view their own startup" 
ON public.startups 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to update their own startup" 
ON public.startups 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id);

-- Fix policies for college_profiles table
DROP POLICY IF EXISTS "Users can view their own college profile" ON public.college_profiles;
DROP POLICY IF EXISTS "Users can insert their own college profile" ON public.college_profiles;
DROP POLICY IF EXISTS "Users can update their own college profile" ON public.college_profiles;

CREATE POLICY "Allow users to view their own college profile" 
ON public.college_profiles 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to insert their own college profile" 
ON public.college_profiles 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to update their own college profile" 
ON public.college_profiles 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id);

-- Fix policies for startup_profiles table
DROP POLICY IF EXISTS "Users can view their own startup profile" ON public.startup_profiles;
DROP POLICY IF EXISTS "Users can insert their own startup profile" ON public.startup_profiles;
DROP POLICY IF EXISTS "Users can update their own startup profile" ON public.startup_profiles;

CREATE POLICY "Allow users to view their own startup profile" 
ON public.startup_profiles 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to insert their own startup profile" 
ON public.startup_profiles 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to update their own startup profile" 
ON public.startup_profiles 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id);