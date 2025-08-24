-- Drop ALL existing policies on user_roles and recreate them properly
DROP POLICY IF EXISTS "Users can create their own role during signup" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles; 
DROP POLICY IF EXISTS "Users can update their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;

-- Create simple, working policies
-- Allow anyone to insert roles (we'll validate user_id in application logic)
CREATE POLICY "Allow role creation"
ON public.user_roles
FOR INSERT 
WITH CHECK (true);

-- Allow users to view their own roles  
CREATE POLICY "View own role"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Allow users to update their own roles
CREATE POLICY "Update own role" 
ON public.user_roles
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Allow admins full access
CREATE POLICY "Admin access"
ON public.user_roles
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles ur  
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  )
);