-- Fix the generate_unique_slug function to ensure proper slug generation
-- This fixes the "function generate_unique_slug(text) does not exist" error

-- Drop existing auto_generate_slug trigger if it exists
DROP TRIGGER IF EXISTS auto_generate_slug_trigger ON public.student_profiles;

-- Drop existing function if it exists with wrong signature  
DROP FUNCTION IF EXISTS public.generate_unique_slug(text);

-- Ensure the correct generate_unique_slug function exists
CREATE OR REPLACE FUNCTION public.generate_unique_slug(input_text text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    base_slug text;
    final_slug text;
    counter integer := 0;
BEGIN
    -- Convert to lowercase, replace spaces with hyphens, remove special characters
    base_slug := lower(regexp_replace(input_text, '[^a-zA-Z0-9\s]', '', 'g'));
    base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
    base_slug := trim(both '-' from base_slug);
    
    -- If empty after cleaning, use 'user'
    IF base_slug = '' THEN
        base_slug := 'user';
    END IF;
    
    final_slug := base_slug;
    
    -- Check if slug exists and increment counter if needed
    WHILE EXISTS (SELECT 1 FROM public.student_profiles WHERE slug = final_slug) LOOP
        counter := counter + 1;
        final_slug := base_slug || '-' || counter::text;
    END LOOP;
    
    RETURN final_slug;
END;
$$;

-- Update the auto_generate_slug trigger function to use correct function call
CREATE OR REPLACE FUNCTION public.auto_generate_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only generate slug if it's not already set
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_unique_slug(NEW.full_name);
  END IF;
  RETURN NEW;
END;
$$;

-- Recreate the trigger for student_profiles
CREATE TRIGGER auto_generate_slug_trigger
    BEFORE INSERT OR UPDATE ON public.student_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_generate_slug();

-- Update any existing student_profiles that don't have slugs
UPDATE public.student_profiles 
SET slug = public.generate_unique_slug(full_name) 
WHERE slug IS NULL OR slug = '';