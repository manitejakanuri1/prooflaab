-- Delete the problematic user and related records
DELETE FROM user_roles WHERE user_id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';
DELETE FROM colleges WHERE user_id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';
DELETE FROM students WHERE user_id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';

-- Fix the recursive RLS policy issue on user_roles table
-- Drop the problematic recursive policies first
DROP POLICY IF EXISTS "Admin access" ON user_roles;
DROP POLICY IF EXISTS "Update own role" ON user_roles;
DROP POLICY IF EXISTS "View own role" ON user_roles;
DROP POLICY IF EXISTS "Users can create their own role" ON user_roles;
DROP POLICY IF EXISTS "Allow role creation" ON user_roles;

-- Create new non-recursive policies for user_roles
CREATE POLICY "Users can view their own role"
ON user_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own role during signup"
ON user_roles FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their wizard completion status"
ON user_roles FOR UPDATE
TO authenticated
using (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admin policy should use a simple check without recursion
CREATE POLICY "Admins can manage all user roles"
ON user_roles FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur 
    WHERE ur.user_id = auth.uid() 
    AND ur.role = 'admin'::app_role
  )
);

-- Delete the user from auth.users (this will cascade delete related records)
DELETE FROM auth.users WHERE id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';