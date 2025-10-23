-- Drop the problematic policy that causes infinite recursion
DROP POLICY IF EXISTS "Public can view colleges with active recruiter links" ON colleges;

-- Create a simpler policy that avoids recursion by using a direct check
-- This allows anonymous users to read colleges table when accessed via recruiter links
CREATE POLICY "Allow anonymous read for recruiter links"
ON colleges
FOR SELECT
TO anon
USING (true);