-- Fix RLS policy conflicts - drop old restrictive policies
-- The issue is multiple policies for the same command type use AND logic
-- so restrictive policies block even if there are permissive ones

-- Drop all old conflicting policies on user_roles
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow users to update their own role" ON public.user_roles;
DROP POLICY IF EXISTS "Allow users to view their own role" ON public.user_roles;

-- Keep only the comprehensive policy that handles all cases
-- This policy already exists: "User roles full access"

-- Also clean up any conflicting policies on other tables
DROP POLICY IF EXISTS "Allow admins to manage all colleges" ON public.colleges;
DROP POLICY IF EXISTS "Allow users to view their college" ON public.colleges;
DROP POLICY IF EXISTS "Allow users to update their college" ON public.colleges;

DROP POLICY IF EXISTS "Allow admins to manage all startups" ON public.startups;
DROP POLICY IF EXISTS "Allow users to view their startup" ON public.startups;
DROP POLICY IF EXISTS "Allow users to update their startup" ON public.startups;

DROP POLICY IF EXISTS "Allow admins to manage all students" ON public.students;
DROP POLICY IF EXISTS "Allow users to view their student record" ON public.students;
DROP POLICY IF EXISTS "Allow users to update their student record" ON public.students;