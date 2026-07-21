-- Add new columns to student_profiles for better admin monitoring
ALTER TABLE public.student_profiles 
ADD COLUMN source text DEFAULT 'Website' CHECK (source IN ('Website', 'College')),
ADD COLUMN last_active timestamp with time zone DEFAULT now();

-- Update existing records to set source based on college_id
UPDATE public.student_profiles 
SET source = CASE 
  WHEN college_id IS NOT NULL THEN 'College'
  ELSE 'Website'
END;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_student_profiles_source ON public.student_profiles(source);
CREATE INDEX IF NOT EXISTS idx_student_profiles_last_active ON public.student_profiles(last_active);

-- Create a function to update last_active when proof is uploaded
CREATE OR REPLACE FUNCTION public.update_student_last_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.student_profiles 
  SET last_active = now()
  WHERE id = NEW.student_id;
  RETURN NEW;
END;
$function$;

-- Create trigger to update last_active when proof is uploaded
CREATE TRIGGER update_student_last_active_on_proof
  AFTER INSERT ON public.proof_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_student_last_active();