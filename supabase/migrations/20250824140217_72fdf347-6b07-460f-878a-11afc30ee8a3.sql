-- Add has_completed_wizard field to user_roles table
ALTER TABLE public.user_roles 
ADD COLUMN has_completed_wizard boolean NOT NULL DEFAULT false;

-- Create tables for storing onboarding wizard data if they don't exist
CREATE TABLE IF NOT EXISTS public.college_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  college_name text NOT NULL,
  location text,
  branches_offered text[],
  student_strength integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.startup_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  startup_name text NOT NULL,
  domain_industry text,
  talent_needs text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS on new tables
ALTER TABLE public.college_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.startup_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for college_profiles
CREATE POLICY "Users can insert their own college profile" 
ON public.college_profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own college profile" 
ON public.college_profiles 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own college profile" 
ON public.college_profiles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage college profiles" 
ON public.college_profiles 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for startup_profiles
CREATE POLICY "Users can insert their own startup profile" 
ON public.startup_profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own startup profile" 
ON public.startup_profiles 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own startup profile" 
ON public.startup_profiles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage startup profiles" 
ON public.startup_profiles 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add fields to student_profiles for wizard data if not exists
ALTER TABLE public.student_profiles 
ADD COLUMN IF NOT EXISTS year_of_study text,
ADD COLUMN IF NOT EXISTS key_interests text[],
ADD COLUMN IF NOT EXISTS preferred_skills text[],
ADD COLUMN IF NOT EXISTS career_goals text;

-- Create trigger for updating timestamps
CREATE OR REPLACE FUNCTION update_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_college_profiles_updated_at
    BEFORE UPDATE ON public.college_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_profile_updated_at();

CREATE TRIGGER update_startup_profiles_updated_at
    BEFORE UPDATE ON public.startup_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_profile_updated_at();