
-- Update the existing student_portfolios table to add missing fields
ALTER TABLE public.student_portfolios 
ADD COLUMN IF NOT EXISTS projects jsonb DEFAULT '[]'::jsonb;

-- Update the table structure to match requirements
-- Note: id, student_id, bio, skills, achievements, is_public already exist
-- We just need to add the projects field and update the slug to reference student_profiles

-- Drop the existing public_url_slug column and replace with slug that matches student_profiles
ALTER TABLE public.student_portfolios 
DROP COLUMN IF EXISTS public_url_slug;

ALTER TABLE public.student_portfolios 
ADD COLUMN slug text;

-- Create function to sync slug with student_profiles
CREATE OR REPLACE FUNCTION sync_portfolio_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update portfolio slug when student profile slug changes
  UPDATE public.student_portfolios 
  SET slug = NEW.slug 
  WHERE student_id = NEW.id;
  RETURN NEW;
END;
$$;

-- Create trigger to keep portfolio slug in sync with student profile slug
DROP TRIGGER IF EXISTS trigger_sync_portfolio_slug ON public.student_profiles;
CREATE TRIGGER trigger_sync_portfolio_slug
  AFTER UPDATE OF slug ON public.student_profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_portfolio_slug();

-- Populate slug field for existing portfolios
UPDATE public.student_portfolios 
SET slug = (
  SELECT sp.slug 
  FROM public.student_profiles sp 
  WHERE sp.id = student_portfolios.student_id
)
WHERE slug IS NULL;

-- Make slug unique after populating
ALTER TABLE public.student_portfolios 
ADD CONSTRAINT unique_portfolio_slug UNIQUE (slug);

-- Create function to set initial portfolio slug on insert
CREATE OR REPLACE FUNCTION set_initial_portfolio_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Set slug from student_profiles when portfolio is created
  SELECT slug INTO NEW.slug 
  FROM public.student_profiles 
  WHERE id = NEW.student_id;
  RETURN NEW;
END;
$$;

-- Create trigger to set initial slug on portfolio insert
DROP TRIGGER IF EXISTS trigger_set_initial_portfolio_slug ON public.student_portfolios;
CREATE TRIGGER trigger_set_initial_portfolio_slug
  BEFORE INSERT ON public.student_portfolios
  FOR EACH ROW
  EXECUTE FUNCTION set_initial_portfolio_slug();
