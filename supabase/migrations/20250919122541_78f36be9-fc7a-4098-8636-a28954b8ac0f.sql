-- Fix security warning by dropping trigger first, then recreating function and trigger
DROP TRIGGER IF EXISTS update_student_last_active_on_proof ON public.proof_uploads;
DROP FUNCTION IF EXISTS public.update_student_last_active();

-- Recreate function with proper search_path
CREATE OR REPLACE FUNCTION public.update_student_last_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  UPDATE public.student_profiles 
  SET last_active = now()
  WHERE id = NEW.student_id;
  RETURN NEW;
END;
$function$;

-- Recreate trigger
CREATE TRIGGER update_student_last_active_on_proof
  AFTER INSERT ON public.proof_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_student_last_active();