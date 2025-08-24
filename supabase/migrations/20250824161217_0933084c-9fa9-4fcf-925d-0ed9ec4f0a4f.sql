-- Fix circular dependency in user_roles RLS policy
-- The current policy prevents users from inserting their first role
-- because it checks if they already have a role (which they don't during signup)

-- Drop the problematic policy
DROP POLICY IF EXISTS "User roles full access" ON public.user_roles;

-- Create separate policies that avoid circular dependency
-- Allow users to INSERT their first role without checking existing roles
CREATE POLICY "Users can insert their own roles" ON public.user_roles
FOR INSERT 
WITH CHECK (user_id = auth.uid());

-- Allow users to SELECT their own roles
CREATE POLICY "Users can view their own roles" ON public.user_roles
FOR SELECT 
USING (user_id = auth.uid());

-- Allow users to UPDATE their own roles (for wizard completion)
CREATE POLICY "Users can update their own roles" ON public.user_roles
FOR UPDATE 
USING (user_id = auth.uid());

-- Allow admins full access (but don't require it for regular operations)
CREATE POLICY "Admins have full access to roles" ON public.user_roles
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));