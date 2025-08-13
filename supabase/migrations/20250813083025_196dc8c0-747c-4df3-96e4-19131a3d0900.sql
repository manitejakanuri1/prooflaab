-- Fix the generate_unique_slug function that's missing
CREATE OR REPLACE FUNCTION public.generate_unique_slug(base_name text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 0;
  random_suffix text;
BEGIN
  -- Convert name to lowercase and replace spaces with hyphens
  base_slug := lower(trim(regexp_replace(base_name, '[^a-zA-Z0-9\s]', '', 'g')));
  base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
  
  -- Generate random 4-digit suffix
  random_suffix := lpad((random() * 9999)::integer::text, 4, '0');
  final_slug := base_slug || '-' || random_suffix;
  
  -- Check if slug exists and increment if needed
  WHILE EXISTS (SELECT 1 FROM public.student_profiles WHERE slug = final_slug) LOOP
    counter := counter + 1;
    random_suffix := lpad((random() * 9999)::integer::text, 4, '0');
    final_slug := base_slug || '-' || random_suffix;
  END LOOP;
  
  RETURN final_slug;
END;
$function$;

-- Fix invite_codes RLS policies - allow authenticated users to create invite codes during signup
DROP POLICY IF EXISTS "Users can create invite codes during signup" ON public.invite_codes;

CREATE POLICY "Users can create invite codes during signup" 
ON public.invite_codes 
FOR INSERT 
TO authenticated
WITH CHECK (
  role IN ('college_admin', 'startup') AND 
  (created_by = auth.uid() OR created_by IS NULL)
);

-- Add missing college and startup tables if they don't exist
CREATE TABLE IF NOT EXISTS public.colleges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  college_name text NOT NULL,
  email text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.startups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  email text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.startups ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for colleges table
CREATE POLICY "Users can insert their own college record" 
ON public.colleges 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own college record" 
ON public.colleges 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own college record" 
ON public.colleges 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create RLS policies for startups table
CREATE POLICY "Users can insert their own startup record" 
ON public.startups 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own startup record" 
ON public.startups 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own startup record" 
ON public.startups 
FOR UPDATE 
USING (auth.uid() = user_id);