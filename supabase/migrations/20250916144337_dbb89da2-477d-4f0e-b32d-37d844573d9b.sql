-- Fix duplicate notification creation by updating triggers to be more specific
-- and add safeguards against duplicate creation

-- Drop and recreate the task assignment notification trigger with duplicate prevention
DROP TRIGGER IF EXISTS task_assignment_notification_trigger ON tasks;
DROP FUNCTION IF EXISTS create_task_assignment_notification();

CREATE OR REPLACE FUNCTION public.create_task_assignment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Only create notification if there's actually a student assigned
  -- and it's a new assignment (student_id changed from NULL to a value)
  IF NEW.student_id IS NOT NULL AND OLD.student_id IS NULL THEN
    -- Check if notification already exists to prevent duplicates
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications 
      WHERE student_id = NEW.student_id 
        AND type = 'task'
        AND message = 'New task assigned: "' || NEW.title || '"'
        AND created_at > now() - interval '1 minute'
    ) THEN
      INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
      VALUES (
        NEW.student_id,
        'task',
        'New Task Assigned',
        'New task assigned: "' || NEW.title || '"',
        false,
        now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Recreate the trigger
CREATE TRIGGER task_assignment_notification_trigger
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.create_task_assignment_notification();