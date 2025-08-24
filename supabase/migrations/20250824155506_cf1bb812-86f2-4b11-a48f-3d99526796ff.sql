-- Remove remaining conflicting RLS policies on user_roles
-- PostgreSQL RLS uses AND logic between policies of the same command type
-- So restrictive policies block even if there are permissive ones

-- Drop the remaining old conflicting policies on user_roles
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles; 
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow users to update their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Allow users to view their own role" ON public.user_roles;

-- The comprehensive "User roles full access" policy remains and handles all cases correctly