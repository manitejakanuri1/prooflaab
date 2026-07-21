-- Create admin_notifications table
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('proof', 'task', 'user', 'system')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  metadata JSONB
);

-- Enable RLS
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can view their own notifications"
  ON public.admin_notifications
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update their own notifications"
  ON public.admin_notifications
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete their own notifications"
  ON public.admin_notifications
  FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_admin_notifications_user_id ON public.admin_notifications(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_is_read ON public.admin_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at ON public.admin_notifications(created_at DESC);

-- Function to create notification for all admins
CREATE OR REPLACE FUNCTION public.notify_all_admins(
  notification_type TEXT,
  notification_title TEXT,
  notification_message TEXT,
  notification_link TEXT DEFAULT NULL,
  notification_metadata JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.admin_notifications (admin_user_id, type, title, message, link, metadata)
  SELECT ur.user_id, notification_type, notification_title, notification_message, notification_link, notification_metadata
  FROM public.user_roles ur
  WHERE ur.role = 'admin'::app_role;
END;
$$;

-- Trigger to notify admins when new proof is submitted
CREATE OR REPLACE FUNCTION public.notify_admins_new_proof()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  student_name TEXT;
  task_title TEXT;
BEGIN
  SELECT sp.full_name INTO student_name
  FROM public.student_profiles sp
  WHERE sp.id = NEW.student_id;
  
  SELECT t.title INTO task_title
  FROM public.tasks t
  WHERE t.id = NEW.task_id;
  
  PERFORM public.notify_all_admins(
    'proof',
    'New Proof Submission',
    student_name || ' submitted proof for "' || task_title || '"',
    '/admin/proof-submissions',
    jsonb_build_object('proof_id', NEW.id, 'student_id', NEW.student_id)
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_admins_new_proof
  AFTER INSERT ON public.proof_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_new_proof();

-- Trigger to notify admins when new user registers
CREATE OR REPLACE FUNCTION public.notify_admins_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  user_type TEXT;
  user_name TEXT;
BEGIN
  -- Determine user type and name
  IF NEW.role = 'student' THEN
    SELECT 'Student', sp.full_name INTO user_type, user_name
    FROM public.student_profiles sp
    WHERE sp.user_id = NEW.user_id
    LIMIT 1;
  ELSIF NEW.role = 'college_admin' THEN
    SELECT 'College', c.name INTO user_type, user_name
    FROM public.colleges c
    WHERE c.user_id = NEW.user_id
    LIMIT 1;
  ELSIF NEW.role = 'startup' THEN
    SELECT 'Startup', s.name INTO user_type, user_name
    FROM public.startups s
    WHERE s.user_id = NEW.user_id
    LIMIT 1;
  ELSE
    RETURN NEW;
  END IF;
  
  IF user_name IS NOT NULL THEN
    PERFORM public.notify_all_admins(
      'user',
      'New ' || user_type || ' Registration',
      user_name || ' has registered as a ' || user_type,
      '/admin/users',
      jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role)
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_admins_new_user
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  WHEN (NEW.role IN ('student', 'college_admin', 'startup'))
  EXECUTE FUNCTION public.notify_admins_new_user();

-- Trigger to notify admins when new task needs approval
CREATE OR REPLACE FUNCTION public.notify_admins_task_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  creator_name TEXT;
BEGIN
  -- Only notify for tasks that need approval
  IF NEW.approved_by_admin = false AND NEW.status = 'Pending' THEN
    IF NEW.created_by_startup_id IS NOT NULL THEN
      SELECT s.name INTO creator_name
      FROM public.startups s
      WHERE s.user_id = NEW.created_by_startup_id;
      
      PERFORM public.notify_all_admins(
        'task',
        'Task Approval Required',
        creator_name || ' created a new task: "' || NEW.title || '"',
        '/admin/tasks',
        jsonb_build_object('task_id', NEW.id, 'creator_type', 'startup')
      );
    ELSIF NEW.created_by_college_id IS NOT NULL THEN
      SELECT c.name INTO creator_name
      FROM public.colleges c
      WHERE c.id = NEW.created_by_college_id;
      
      PERFORM public.notify_all_admins(
        'task',
        'Task Approval Required',
        creator_name || ' created a new task: "' || NEW.title || '"',
        '/admin/tasks',
        jsonb_build_object('task_id', NEW.id, 'creator_type', 'college')
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_admins_task_approval
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_task_approval();