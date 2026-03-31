
-- Fix 1: Remove overly permissive anonymous read on colleges
DROP POLICY IF EXISTS "Allow anonymous read for recruiter links" ON public.colleges;

-- Create a limited view for recruiter access (only name, no email/invite_code)
CREATE OR REPLACE VIEW public.colleges_public
WITH (security_invoker = on) AS
  SELECT id, name
  FROM public.colleges;

-- Fix 2: Remove overly permissive public read on student_profiles
DROP POLICY IF EXISTS "Public can view profiles" ON public.student_profiles;

-- Add policy: authenticated users can view all profiles (for feed, leaderboard, etc.)
CREATE POLICY "Authenticated users can view profiles"
  ON public.student_profiles FOR SELECT
  TO authenticated
  USING (true);

-- Add policy: anonymous can view only public profiles (for recruiter view)
CREATE POLICY "Anonymous can view public profiles"
  ON public.student_profiles FOR SELECT
  TO anon
  USING (profile_visibility = 'public');

-- Fix 3: Create a view for admin_users that excludes password_hash
CREATE OR REPLACE VIEW public.admin_users_safe
WITH (security_invoker = on) AS
  SELECT id, email, name, role, status, created_at, updated_at
  FROM public.admin_users;
