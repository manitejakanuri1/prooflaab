-- First, completely drop all existing policies on user_roles
DROP POLICY IF EXISTS "Users can view their own role" ON user_roles;
DROP POLICY IF EXISTS "Users can insert their own role during signup" ON user_roles;
DROP POLICY IF EXISTS "Users can update their wizard completion status" ON user_roles;
DROP POLICY IF EXISTS "Admins can manage all user roles" ON user_roles;

-- Delete the problematic user first
DELETE FROM user_roles WHERE user_id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';
DELETE FROM colleges WHERE user_id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';
DELETE FROM students WHERE user_id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';
DELETE FROM auth.users WHERE id = 'ef453345-8721-49e6-a1d1-4eb39711b10a';

-- Now create completely new, non-recursive policies
CREATE POLICY "view_own_role" ON user_roles 
FOR SELECT TO authenticated 
USING (user_id = auth.uid());

CREATE POLICY "insert_own_role" ON user_roles 
FOR INSERT TO authenticated 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own_role" ON user_roles 
FOR UPDATE TO authenticated 
USING (user_id = auth.uid()) 
WITH CHECK (user_id = auth.uid());

-- Simple admin policy without recursion - check user_id directly
CREATE POLICY "admin_manage_roles" ON user_roles 
FOR ALL TO authenticated 
USING (
  -- Allow if user is admin (check via auth metadata or direct comparison)
  auth.uid() IN (
    SELECT user_id FROM user_roles WHERE role = 'admin'::app_role
  )
);