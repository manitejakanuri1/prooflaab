-- Re-enable RLS with better policies for the signup flow
-- Now that we've tested the flow, let's create proper RLS policies

-- Re-enable RLS on all tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY; 
ALTER TABLE public.startups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- Create comprehensive RLS policies that work during signup and normal operations

-- 1. User roles - allow creation during signup, own access after
DROP POLICY IF EXISTS "Allow user role creation during signup" ON public.user_roles;
CREATE POLICY "User roles full access" ON public.user_roles
FOR ALL USING (
  -- Admin can see all
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can see their own role
  user_id = auth.uid()
)
WITH CHECK (
  -- Admin can create any role
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can create their own role (during signup or after)
  user_id = auth.uid()
);

-- 2. Colleges - allow creation during signup, own access after  
DROP POLICY IF EXISTS "Allow college creation during signup" ON public.colleges;
CREATE POLICY "Colleges access policy" ON public.colleges
FOR ALL USING (
  -- Admin can see all
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can see their own college record
  user_id = auth.uid()
)
WITH CHECK (
  -- Admin can create/modify any
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can create their own college record
  user_id = auth.uid()
);

-- 3. Startups - allow creation during signup, own access after
DROP POLICY IF EXISTS "Allow startup creation during signup" ON public.startups;
CREATE POLICY "Startups access policy" ON public.startups  
FOR ALL USING (
  -- Admin can see all
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can see their own startup record
  user_id = auth.uid()
)
WITH CHECK (
  -- Admin can create/modify any
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can create their own startup record
  user_id = auth.uid()
);

-- 4. Students - allow creation during signup, own access after
DROP POLICY IF EXISTS "Allow student creation during signup" ON public.students;
CREATE POLICY "Students access policy" ON public.students
FOR ALL USING (
  -- Admin can see all  
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can see their own student record
  user_id = auth.uid()
)
WITH CHECK (
  -- Admin can create/modify any
  has_role(auth.uid(), 'admin'::app_role) OR
  -- Users can create their own student record  
  user_id = auth.uid()
);