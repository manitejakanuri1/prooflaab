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

-- Insert a sample task for user mohan.padavala@gmail.com for testing
INSERT INTO public.tasks (
  student_id,
  title,
  description,
  due_date,
  status,
  xp_reward,
  xp
)
SELECT 
  sp.id,
  'Build React Dashboard',
  'Design and build a functional student dashboard using React.js and Tailwind CSS. Include components for task management, progress tracking, and user profile.',
  '2025-12-15T23:59:59.000Z',
  'Pending',
  150,
  150
FROM public.student_profiles sp
WHERE sp.email = 'mohan.padavala@gmail.com';