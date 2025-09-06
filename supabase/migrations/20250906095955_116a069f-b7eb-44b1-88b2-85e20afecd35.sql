-- Fix infinite recursion in user_roles RLS policies by creating a security definer function

-- Drop existing policies that cause recursion
DROP POLICY IF EXISTS "admin_manage_roles" ON public.user_roles;
DROP POLICY IF EXISTS "insert_own_role" ON public.user_roles;
DROP POLICY IF EXISTS "update_own_role" ON public.user_roles;
DROP POLICY IF EXISTS "view_own_role" ON public.user_roles;

-- Create a security definer function to safely check user roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to check if current user is admin (security definer)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'::app_role
  )
$$;

-- Create new RLS policies using the security definer functions
CREATE POLICY "admin_manage_roles" ON public.user_roles
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "insert_own_role" ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own_role" ON public.user_roles
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "view_own_role" ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

-- Update other tables that use has_role function to use the new function
-- Update existing policies on other tables to use the new has_role function

-- Fix admin_users table policy
DROP POLICY IF EXISTS "Admins can manage admin users" ON public.admin_users;
CREATE POLICY "Admins can manage admin users" ON public.admin_users
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix announcements table policies
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "Admins can manage announcements" ON public.announcements
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix audit_logs table policy
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs" ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix college_profiles table policies
DROP POLICY IF EXISTS "Admins can manage college profiles" ON public.college_profiles;
CREATE POLICY "Admins can manage college profiles" ON public.college_profiles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix colleges table policy
DROP POLICY IF EXISTS "Colleges access policy" ON public.colleges;
CREATE POLICY "Colleges access policy" ON public.colleges
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR (user_id = auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR (user_id = auth.uid()));

-- Fix invite_codes table policy
DROP POLICY IF EXISTS "Admins can manage invite codes" ON public.invite_codes;
CREATE POLICY "Admins can manage invite codes" ON public.invite_codes
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix invite_codes_validation table policy
DROP POLICY IF EXISTS "Admins can create invite code validations" ON public.invite_codes_validation;
CREATE POLICY "Admins can create invite code validations" ON public.invite_codes_validation
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix job_opportunities table policy
DROP POLICY IF EXISTS "Admins can manage job opportunities" ON public.job_opportunities;
CREATE POLICY "Admins can manage job opportunities" ON public.job_opportunities
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix learning_resources table policy
DROP POLICY IF EXISTS "Admins can manage learning resources" ON public.learning_resources;
CREATE POLICY "Admins can manage learning resources" ON public.learning_resources
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix manual_adjustment_log table policy
DROP POLICY IF EXISTS "Admins can manage adjustment logs" ON public.manual_adjustment_log;
CREATE POLICY "Admins can manage adjustment logs" ON public.manual_adjustment_log
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix startup_profiles table policy
DROP POLICY IF EXISTS "Admins can manage startup profiles" ON public.startup_profiles;
CREATE POLICY "Admins can manage startup profiles" ON public.startup_profiles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Fix startups table policy
DROP POLICY IF EXISTS "Startups access policy" ON public.startups;
CREATE POLICY "Startups access policy" ON public.startups
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR (user_id = auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR (user_id = auth.uid()));

-- Fix students table policy
DROP POLICY IF EXISTS "Students access policy" ON public.students;
CREATE POLICY "Students access policy" ON public.students
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR (user_id = auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR (user_id = auth.uid()));

-- Fix tasks table policy for college admins
DROP POLICY IF EXISTS "College admins can manage tasks" ON public.tasks;
CREATE POLICY "College admins can manage tasks" ON public.tasks
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'college_admin'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'college_admin'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));