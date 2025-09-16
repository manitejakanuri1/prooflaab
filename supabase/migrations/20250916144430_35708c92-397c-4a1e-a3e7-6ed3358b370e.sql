-- Fix duplicate notification triggers by removing duplicates and preventing future duplicates

-- Drop all existing task assignment notification triggers
DROP TRIGGER IF EXISTS trigger_task_assignment_notification ON tasks;
DROP TRIGGER IF EXISTS task_assignment_notification ON tasks;
DROP TRIGGER IF EXISTS task_assignment_notification_trigger ON tasks;

-- Drop the function with CASCADE to remove dependencies
DROP FUNCTION IF EXISTS create_task_assignment_notification() CASCADE;

-- Create a new improved function with duplicate prevention
CREATE OR REPLACE FUNCTION public.create_task_assignment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Only create notification if there's actually a student assigned
  -- and it's a new assignment (student_id changed from NULL to a value)
  IF NEW.student_id IS NOT NULL AND (OLD.student_id IS NULL OR OLD.student_id != NEW.student_id) THEN
    -- Check if notification already exists to prevent duplicates
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications 
      WHERE student_id = NEW.student_id 
        AND type = 'task'
        AND message = 'New task assigned: "' || NEW.title || '"'
        AND created_at > now() - interval '5 minutes'
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

-- Create a single trigger for task assignments (UPDATE only, since that's when student_id changes)
CREATE TRIGGER task_assignment_notification_trigger
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.create_task_assignment_notification();