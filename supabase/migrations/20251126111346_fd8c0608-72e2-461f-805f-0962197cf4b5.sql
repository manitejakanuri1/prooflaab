-- Fix infinite recursion in student_profiles RLS policies
-- Drop ALL existing policies first
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'student_profiles' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.student_profiles';
    END LOOP;
END $$;

-- Create simple, non-recursive policies
-- Policy 1: Users can view their own profile (no recursion)
CREATE POLICY "Students can view own profile"
ON public.student_profiles
FOR SELECT
USING (user_id = auth.uid());

-- Policy 2: Allow public read for anyone (no recursion)
CREATE POLICY "Public can view profiles"
ON public.student_profiles
FOR SELECT
USING (true);

-- Policy 3: Users can update their own profile (no recursion)
CREATE POLICY "Students can update own profile"
ON public.student_profiles
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Policy 4: Allow inserts for own profile
CREATE POLICY "Students can insert own profile"
ON public.student_profiles
FOR INSERT
WITH CHECK (user_id = auth.uid());