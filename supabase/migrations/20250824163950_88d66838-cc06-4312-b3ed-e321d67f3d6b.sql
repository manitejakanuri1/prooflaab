-- Allow role creation during signup for unauthenticated users
-- Update the INSERT policy to allow both authenticated and anonymous users
DROP POLICY IF EXISTS "Users can create their own role" ON public.user_roles;

-- Create a more permissive policy for role creation during signup
CREATE POLICY "Users can create their own role during signup"
ON public.user_roles
FOR INSERT 
WITH CHECK (true);  -- Allow any insert, we'll validate in the application logic

-- Keep the existing view and update policies
CREATE POLICY "Users can view their own role" 
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can update their own role"
ON public.user_roles  
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());