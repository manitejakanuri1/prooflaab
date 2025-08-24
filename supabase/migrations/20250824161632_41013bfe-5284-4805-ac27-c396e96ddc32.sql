-- Fix the RLS policies with correct syntax
-- Drop existing policies first
DROP POLICY IF EXISTS "Allow role creation during signup" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can update their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins have full access to roles" ON public.user_roles;

-- Create simple, working policies
-- Allow users to insert their own roles (this will work once auth.uid() is set)
CREATE POLICY "Users can insert roles" ON public.user_roles
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Allow users to view their own roles  
CREATE POLICY "Users can view roles" ON public.user_roles
FOR SELECT 
USING (user_id = auth.uid());

-- Allow users to update their own roles (for wizard completion)
CREATE POLICY "Users can update roles" ON public.user_roles
FOR UPDATE 
USING (user_id = auth.uid());

-- Allow admins full access
CREATE POLICY "Admins manage roles" ON public.user_roles
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));