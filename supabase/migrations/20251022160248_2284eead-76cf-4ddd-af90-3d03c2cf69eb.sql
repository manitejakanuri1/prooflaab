-- Fix the create_application_status_notification function to use valid status
DROP FUNCTION IF EXISTS public.create_application_status_notification() CASCADE;

CREATE OR REPLACE FUNCTION public.create_application_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only create notification if status changed
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('Accepted', 'Rejected') THEN
    INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
    VALUES (
      NEW.student_id,
      'application_status',
      CASE 
        WHEN NEW.status = 'Accepted' THEN 'Application Accepted ✅'
        WHEN NEW.status = 'Rejected' THEN 'Application Rejected ❌'
      END,
      CASE 
        WHEN NEW.status = 'Accepted' THEN 'Your application for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was accepted!'
        WHEN NEW.status = 'Rejected' THEN 'Your application for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was rejected. ' || COALESCE('Reason: ' || NEW.rejection_reason, '')
      END,
      false,
      now()
    );

    -- If accepted, assign the task to the student with valid status
    IF NEW.status = 'Accepted' THEN
      UPDATE public.tasks 
      SET 
        student_id = NEW.student_id,
        status = 'In Progress',
        started_at = now(),
        updated_at = now()
      WHERE id = NEW.task_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_application_status_change ON public.task_applications;
CREATE TRIGGER on_application_status_change
  AFTER UPDATE ON public.task_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.create_application_status_notification();