-- Add link and read_at columns to notifications table
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS link text,
ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;

-- Create function to notify all active students about new announcements
CREATE OR REPLACE FUNCTION public.create_announcement_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Insert notification for all active students
  INSERT INTO public.notifications (student_id, type, title, message, link, is_read, created_at)
  SELECT 
    sp.id,
    'announcement',
    NEW.title,
    LEFT(NEW.description, 150),
    '/student/announcements/' || NEW.id::text,
    false,
    NOW()
  FROM public.student_profiles sp
  WHERE sp.status = 'active';
  
  RETURN NEW;
END;
$function$;

-- Create trigger for announcement notifications
DROP TRIGGER IF EXISTS announcement_notification_trigger ON public.announcements;
CREATE TRIGGER announcement_notification_trigger
AFTER INSERT ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.create_announcement_notifications();

-- Create function to notify students about new public tasks
CREATE OR REPLACE FUNCTION public.create_task_posted_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only create notifications for public tasks that are approved
  IF NEW.visibility = 'public' AND NEW.approved_by_admin = true AND NEW.student_id IS NULL THEN
    INSERT INTO public.notifications (student_id, type, title, message, link, is_read, created_at)
    SELECT 
      sp.id,
      'task_posted',
      'New Task Available',
      'New task posted: "' || NEW.title || '"',
      '/student/tasks/' || NEW.id::text,
      false,
      NOW()
    FROM public.student_profiles sp
    WHERE sp.status = 'active';
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create trigger for task posted notifications
DROP TRIGGER IF EXISTS task_posted_notification_trigger ON public.tasks;
CREATE TRIGGER task_posted_notification_trigger
AFTER INSERT ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.create_task_posted_notifications();

-- Update the existing task assignment notification trigger to use the new link field
DROP TRIGGER IF EXISTS task_assignment_notification ON public.tasks;
CREATE OR REPLACE FUNCTION public.create_task_assignment_notification_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
      INSERT INTO public.notifications (student_id, type, title, message, link, is_read, created_at)
      VALUES (
        NEW.student_id,
        'task',
        'New Task Assigned',
        'New task assigned: "' || NEW.title || '"',
        '/student/tasks/' || NEW.id::text,
        false,
        now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER task_assignment_notification_v2
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.create_task_assignment_notification_v2();