-- Step 1: Create proper role-based tables with user_id foreign keys
-- Drop existing tables if they exist and recreate with proper structure
DROP TABLE IF EXISTS public.students CASCADE;
DROP TABLE IF EXISTS public.colleges CASCADE;
DROP TABLE IF EXISTS public.startups CASCADE;

-- Create students table
CREATE TABLE public.students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  branch TEXT,
  batch TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create colleges table with status tracking
CREATE TABLE public.colleges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  invite_code TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create startups table with status tracking
CREATE TABLE public.startups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  invite_code TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.startups ENABLE ROW LEVEL SECURITY;

-- RLS policies for students
CREATE POLICY "Users can view their own student record"
  ON public.students FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own student record"
  ON public.students FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own student record"
  ON public.students FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS policies for colleges
CREATE POLICY "Users can view their own college record"
  ON public.colleges FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own college record"
  ON public.colleges FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own college record"
  ON public.colleges FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS policies for startups
CREATE POLICY "Users can view their own startup record"
  ON public.startups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own startup record"
  ON public.startups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own startup record"
  ON public.startups FOR UPDATE
  USING (auth.uid() = user_id);

-- Fix existing user_roles table policies
DROP POLICY IF EXISTS "Allow authenticated users to insert roles during signup" ON public.user_roles;
DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

-- Create proper RLS policies for user_roles
CREATE POLICY "Users can insert their own role during signup"
  ON public.user_roles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own role"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- Update invite_codes table policies
DROP POLICY IF EXISTS "Users can create invite codes during signup" ON public.invite_codes;
DROP POLICY IF EXISTS "Allow authenticated users to insert invite codes" ON public.invite_codes;

CREATE POLICY "Users can create invite codes during signup"
  ON public.invite_codes FOR INSERT
  WITH CHECK (auth.uid() = created_by OR created_by IS NULL);

-- Create triggers for updating timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_colleges_updated_at
  BEFORE UPDATE ON public.colleges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_startups_updated_at
  BEFORE UPDATE ON public.startups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();