-- Drop conflicting RLS policies on startups table
DROP POLICY IF EXISTS "Allow users to view their own startup" ON startups;
DROP POLICY IF EXISTS "Allow users to update their own startup" ON startups;
DROP POLICY IF EXISTS "Users can view their own startup record" ON startups;
DROP POLICY IF EXISTS "Users can update their own startup record" ON startups;

-- Recreate clean RLS policies for startups table
CREATE POLICY "Admins can manage all startups"
ON startups
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Startups can view their own record"
ON startups
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Startups can update their own record"
ON startups
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);