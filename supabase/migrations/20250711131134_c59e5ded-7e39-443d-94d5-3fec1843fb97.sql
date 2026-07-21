-- Fix the task assignment notification trigger - use NEW.id instead of NEW.task_id
CREATE OR REPLACE FUNCTION public.create_task_assignment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
  VALUES (
    NEW.student_id,
    'task',
    'New Task Assigned',
    'New task assigned: "' || NEW.title || '"',
    false,
    now()
  );
  RETURN NEW;
END;
$function$;

-- Create the trigger for task assignments
DROP TRIGGER IF EXISTS task_assignment_notification ON public.tasks;
CREATE TRIGGER task_assignment_notification
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.create_task_assignment_notification();

-- (One-off sample-task INSERT removed: contained a real user's email address.)
