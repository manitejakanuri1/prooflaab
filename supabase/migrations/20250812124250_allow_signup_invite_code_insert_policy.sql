-- Allow users to insert invite codes during signup process
-- This policy allows authenticated users to create invite codes for college/startup roles
CREATE POLICY "Allow signup invite code creation"
ON public.invite_codes
FOR INSERT
TO authenticated
WITH CHECK (
  -- Allow if the user is creating an invite code for themselves during signup
  -- and they are requesting college_admin or startup role
  role IN ('college_admin', 'startup') AND 
  created_by = auth.uid()
);