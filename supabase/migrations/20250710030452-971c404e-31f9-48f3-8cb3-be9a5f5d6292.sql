
-- Add slug column to student_profiles table
ALTER TABLE public.student_profiles 
ADD COLUMN slug text UNIQUE;

-- Create function to generate unique slug from name
CREATE OR REPLACE FUNCTION generate_unique_slug(base_name text)
RETURNS text
LANGUAGE plpgsql
AS $$
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
$$;

-- Create trigger function to auto-generate slug on insert
CREATE OR REPLACE FUNCTION auto_generate_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only generate slug if it's not already set
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_unique_slug(NEW.full_name);
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger to auto-generate slug before insert
CREATE TRIGGER trigger_auto_generate_slug
  BEFORE INSERT ON public.student_profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_slug();

-- Generate slugs for existing students who don't have one
UPDATE public.student_profiles 
SET slug = generate_unique_slug(full_name)
WHERE slug IS NULL;
