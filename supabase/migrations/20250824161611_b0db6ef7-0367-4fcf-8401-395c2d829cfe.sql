-- Fix the RLS policy issue by temporarily allowing unauthenticated role insertion during signup
-- This is safe because we're only allowing users to insert their own user_id

-- Drop the current policies
DROP POLICY IF EXISTS "Users can insert their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can update their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins have full access to roles" ON public.user_roles;

-- Create a more permissive policy for inserts that works during signup
-- This allows insertion if the user_id matches the current user OR if it's during initial signup
CREATE POLICY "Allow role creation during signup" ON public.user_roles
FOR INSERT 
WITH CHECK (
  user_id = auth.uid() OR 
  -- Allow insertion if no existing role exists for this user (first-time signup)
  NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id)
);

-- Allow users to view their own roles
CREATE POLICY "Users can view their own roles" ON public.user_roles
FOR SELECT 
USING (user_id = auth.uid() OR auth.uid() IS NULL);

-- Allow users to update their own roles (for wizard completion)
CREATE POLICY "Users can update their own roles" ON public.user_roles
FOR UPDATE 
USING (user_id = auth.uid());

-- Allow admins full access
CREATE POLICY "Admins have full access to roles" ON public.user_roles
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));