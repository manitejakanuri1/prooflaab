-- Fix RLS policies to allow user creation during signup
-- The issue is that during signup, auth.uid() is not yet available when creating initial records

-- 1. Fix user_roles policy - allow insertion during signup when user doesn't exist yet
DROP POLICY IF EXISTS "Users can insert their own role during signup" ON public.user_roles;
DROP POLICY IF EXISTS "Allow authenticated users to insert their own role" ON public.user_roles;
CREATE POLICY "Allow user role creation during signup" ON public.user_roles
FOR INSERT 
WITH CHECK (
  -- Allow if user is inserting their own role
  user_id = auth.uid() OR 
  -- Allow if this is during initial signup (user doesn't have a role yet)
  NOT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = NEW.user_id
  )
);

-- 2. Fix colleges policy - allow insertion during signup
DROP POLICY IF EXISTS "Allow authenticated users to insert their own college" ON public.colleges;
DROP POLICY IF EXISTS "Users can insert their own college record" ON public.colleges;
CREATE POLICY "Allow college creation during signup" ON public.colleges
FOR INSERT 
WITH CHECK (
  -- Allow if user is authenticated and creating their own college
  user_id = auth.uid() OR
  -- Allow during signup when user doesn't have a college record yet
  NOT EXISTS (
    SELECT 1 FROM public.colleges 
    WHERE user_id = NEW.user_id
  )
);

-- 3. Fix startups policy - allow insertion during signup  
DROP POLICY IF EXISTS "Allow authenticated users to insert their own startup" ON public.startups;
DROP POLICY IF EXISTS "Users can insert their own startup record" ON public.startups;
CREATE POLICY "Allow startup creation during signup" ON public.startups
FOR INSERT 
WITH CHECK (
  -- Allow if user is authenticated and creating their own startup
  user_id = auth.uid() OR
  -- Allow during signup when user doesn't have a startup record yet
  NOT EXISTS (
    SELECT 1 FROM public.startups 
    WHERE user_id = NEW.user_id
  )
);

-- 4. Fix students policy - allow insertion during signup
DROP POLICY IF EXISTS "Users can insert their own student record" ON public.students;
CREATE POLICY "Allow student creation during signup" ON public.students
FOR INSERT 
WITH CHECK (
  -- Allow if user is authenticated and creating their own student record
  user_id = auth.uid() OR
  -- Allow during signup when user doesn't have a student record yet  
  NOT EXISTS (
    SELECT 1 FROM public.students 
    WHERE user_id = NEW.user_id
  )
);

-- 5. Add missing function to check email confirmation safely
CREATE OR REPLACE FUNCTION public.is_email_confirmed_safe(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT email_confirmed_at IS NOT NULL 
     FROM auth.users 
     WHERE id = user_id), 
    false
  );
$$;