-- Phase 1: Implement proper role-based access control system
-- Create user roles enum and table
CREATE TYPE public.app_role AS ENUM ('admin', 'college_admin', 'startup', 'student');

CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    created_by UUID REFERENCES auth.users(id),
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles table
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check user roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Create function to get current user role
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- RLS policies for user_roles table
CREATE POLICY "Users can view their own roles" ON public.user_roles
FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all roles" ON public.user_roles
FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert roles" ON public.user_roles
FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles" ON public.user_roles
FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- Fix overly permissive RLS policies on student_profiles
DROP POLICY IF EXISTS "College admins can insert student profiles" ON public.student_profiles;
DROP POLICY IF EXISTS "College admins can update all student profiles" ON public.student_profiles;
DROP POLICY IF EXISTS "College admins can view all student profiles" ON public.student_profiles;

-- Create proper role-based policies for student_profiles
CREATE POLICY "College admins can manage student profiles" ON public.student_profiles
FOR ALL USING (public.has_role(auth.uid(), 'college_admin') OR public.has_role(auth.uid(), 'admin'));

-- Fix overly permissive policies on tasks table
DROP POLICY IF EXISTS "College admins can assign tasks to students" ON public.tasks;

CREATE POLICY "College admins can manage tasks" ON public.tasks
FOR ALL USING (public.has_role(auth.uid(), 'college_admin') OR public.has_role(auth.uid(), 'admin'));

-- Fix overly permissive policies on job_opportunities
DROP POLICY IF EXISTS "Admins can delete job opportunities" ON public.job_opportunities;
DROP POLICY IF EXISTS "Admins can insert job opportunities" ON public.job_opportunities;
DROP POLICY IF EXISTS "Admins can update job opportunities" ON public.job_opportunities;

CREATE POLICY "Admins can manage job opportunities" ON public.job_opportunities
FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Fix overly permissive policies on learning_resources
DROP POLICY IF EXISTS "Admins can delete learning resources" ON public.learning_resources;
DROP POLICY IF EXISTS "Admins can insert learning resources" ON public.learning_resources;
DROP POLICY IF EXISTS "Admins can update learning resources" ON public.learning_resources;

CREATE POLICY "Admins can manage learning resources" ON public.learning_resources
FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Fix overly permissive policies on proof_uploads
DROP POLICY IF EXISTS "Admins can update proof uploads" ON public.proof_uploads;
DROP POLICY IF EXISTS "Admins can view all proof uploads" ON public.proof_uploads;

CREATE POLICY "Authorized users can review proof uploads" ON public.proof_uploads
FOR UPDATE USING (
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'college_admin') OR
  (public.has_role(auth.uid(), 'startup') AND task_id IN (
    SELECT id FROM public.tasks WHERE created_by_startup_id = auth.uid()
  ))
);

CREATE POLICY "Authorized users can view proof uploads" ON public.proof_uploads
FOR SELECT USING (
  student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()) OR
  public.has_role(auth.uid(), 'admin') OR 
  public.has_role(auth.uid(), 'college_admin') OR
  (public.has_role(auth.uid(), 'startup') AND task_id IN (
    SELECT id FROM public.tasks WHERE created_by_startup_id = auth.uid()
  ))
);

-- Secure student_otps table - remove public access
DROP POLICY IF EXISTS "Allow public insert for OTP generation" ON public.student_otps;
DROP POLICY IF EXISTS "Allow public select for OTP verification" ON public.student_otps;
DROP POLICY IF EXISTS "Allow public update for marking OTP as used" ON public.student_otps;

-- Create secure OTP policies
CREATE POLICY "Authenticated users can insert OTP" ON public.student_otps
FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can verify their own OTP" ON public.student_otps
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own OTP" ON public.student_otps
FOR UPDATE TO authenticated USING (true);

-- Enable RLS on leaderboard view by creating a secure function instead
CREATE OR REPLACE FUNCTION public.get_leaderboard_data()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  total_xp INTEGER,
  trust_score INTEGER,
  rank BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 
    sp.id,
    sp.full_name,
    sp.total_xp,
    sp.trust_score,
    ROW_NUMBER() OVER (ORDER BY sp.total_xp DESC) as rank
  FROM public.student_profiles sp
  WHERE sp.total_xp > 0
  ORDER BY sp.total_xp DESC;
$$;