-- Drop the old trigger and function that overwrites student_id
DROP TRIGGER IF EXISTS on_application_status_change ON public.task_applications;
DROP FUNCTION IF EXISTS public.create_application_status_notification();

-- Create new function that uses task_assignments for multiple students per task
CREATE OR REPLACE FUNCTION public.create_application_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    -- If accepted, create a task assignment (not overwrite task.student_id)
    IF NEW.status = 'Accepted' THEN
      INSERT INTO public.task_assignments (
        task_id, 
        student_id, 
        status, 
        assigned_at
      )
      VALUES (
        NEW.task_id,
        NEW.student_id,
        'assigned',
        now()
      )
      ON CONFLICT (task_id, student_id) DO NOTHING;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER on_application_status_change
  AFTER UPDATE ON public.task_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.create_application_status_notification();

-- Add unique constraint to prevent duplicate assignments
ALTER TABLE public.task_assignments 
DROP CONSTRAINT IF EXISTS task_assignments_task_id_student_id_key;

ALTER TABLE public.task_assignments 
ADD CONSTRAINT task_assignments_task_id_student_id_key 
UNIQUE (task_id, student_id);