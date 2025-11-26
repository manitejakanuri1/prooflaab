-- Fix infinite recursion in student_profiles RLS policies
-- First, drop ALL existing policies on student_profiles

DROP POLICY IF EXISTS "Students can view their own profile" ON student_profiles;
DROP POLICY IF EXISTS "Students can update their own profile" ON student_profiles;
DROP POLICY IF EXISTS "Students can insert their own profile" ON student_profiles;
DROP POLICY IF EXISTS "Allow users to view their own profile" ON student_profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON student_profiles;
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON student_profiles;
DROP POLICY IF EXISTS "Students can view own profile" ON student_profiles;
DROP POLICY IF EXISTS "Students can insert own profile" ON student_profiles;
DROP POLICY IF EXISTS "Students can update own profile" ON student_profiles;
DROP POLICY IF EXISTS "Public can view profiles with public content" ON student_profiles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON student_profiles;
DROP POLICY IF EXISTS "College admins can view their students" ON student_profiles;

-- Create simple, non-recursive policies using direct auth.uid() comparison
CREATE POLICY "Students can view own profile"
  ON student_profiles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Students can insert own profile"
  ON student_profiles
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Students can update own profile"
  ON student_profiles
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow public read access for profiles linked to public posts/portfolios
CREATE POLICY "Public can view profiles with public content"
  ON student_profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM proof_uploads pu
      WHERE pu.student_id = student_profiles.id
      AND pu.is_public = true
      AND pu.status = 'Verified'
    )
  );

-- Allow admins to manage all profiles
CREATE POLICY "Admins can manage all profiles"
  ON student_profiles
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Allow college admins to view their students
CREATE POLICY "College admins can view their students"
  ON student_profiles
  FOR SELECT
  USING (
    college_id IN (
      SELECT id FROM colleges WHERE user_id = auth.uid()
    )
  );