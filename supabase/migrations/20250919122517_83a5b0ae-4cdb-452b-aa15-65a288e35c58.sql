-- Fix security warning for the update_student_last_active function
DROP FUNCTION IF EXISTS public.update_student_last_active();

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