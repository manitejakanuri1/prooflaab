-- Update existing colleges to set last_active to their created_at date as a starting point
UPDATE public.colleges 
SET last_active = created_at 
WHERE last_active IS NULL;

-- Also create a trigger for when colleges table is updated (like when they log in)
CREATE OR REPLACE FUNCTION public.update_college_last_active_on_login()
RETURNS TRIGGER AS $$
BEGIN
  -- Update last_active when college record is updated (indicating activity)
  IF OLD.updated_at IS DISTINCT FROM NEW.updated_at THEN
    NEW.last_active = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER colleges_update_last_active_trigger
  BEFORE UPDATE ON public.colleges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_college_last_active_on_login();