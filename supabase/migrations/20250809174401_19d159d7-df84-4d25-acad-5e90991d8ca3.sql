-- Create task applications table
CREATE TABLE IF NOT EXISTS public.task_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  application_note TEXT,
  portfolio_link TEXT,
  status TEXT NOT NULL DEFAULT 'Pending Review' CHECK (status IN ('Pending Review', 'Accepted', 'Rejected')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID,
  rejection_reason TEXT,
  UNIQUE(task_id, student_id)
);

-- Enable RLS
ALTER TABLE public.task_applications ENABLE ROW LEVEL SECURITY;

-- RLS policies for task applications
CREATE POLICY "Students can insert their own applications" 
ON public.task_applications 
FOR INSERT 
WITH CHECK (student_id IN ( SELECT student_profiles.id FROM student_profiles WHERE student_profiles.user_id = auth.uid()));

CREATE POLICY "Students can view their own applications" 
ON public.task_applications 
FOR SELECT 
USING (student_id IN ( SELECT student_profiles.id FROM student_profiles WHERE student_profiles.user_id = auth.uid()));

CREATE POLICY "Startups can view applications for their tasks" 
ON public.task_applications 
FOR SELECT 
USING (task_id IN ( SELECT tasks.id FROM tasks WHERE tasks.created_by_startup_id = auth.uid()));

CREATE POLICY "Startups can update applications for their tasks" 
ON public.task_applications 
FOR UPDATE 
USING (task_id IN ( SELECT tasks.id FROM tasks WHERE tasks.created_by_startup_id = auth.uid()));

-- Add XP reward and category fields to tasks table
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS xp_reward INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'restricted'));

-- Create trigger for updating task applications timestamp
CREATE TRIGGER update_task_applications_updated_at
BEFORE UPDATE ON public.task_applications
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create notification function for new applications
CREATE OR REPLACE FUNCTION public.create_application_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Get startup user_id from task
  INSERT INTO public.notifications (
    student_id, 
    type, 
    title, 
    message, 
    is_read, 
    created_at
  )
  SELECT 
    sp.id,
    'application',
    'New Task Application',
    'A student applied for your task: "' || t.title || '"',
    false,
    now()
  FROM public.tasks t
  JOIN public.student_profiles sp ON sp.user_id = t.created_by_startup_id
  WHERE t.id = NEW.task_id;
  
  RETURN NEW;
END;
$function$;

-- Create trigger for application notifications
CREATE TRIGGER create_application_notification_trigger
AFTER INSERT ON public.task_applications
FOR EACH ROW
EXECUTE FUNCTION public.create_application_notification();

-- Create notification function for application status updates
CREATE OR REPLACE FUNCTION public.create_application_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

    -- If accepted, assign the task to the student
    IF NEW.status = 'Accepted' THEN
      UPDATE public.tasks 
      SET 
        student_id = NEW.student_id,
        status = 'Assigned',
        updated_at = now()
      WHERE id = NEW.task_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create trigger for application status notifications
CREATE TRIGGER create_application_status_notification_trigger
AFTER UPDATE ON public.task_applications
FOR EACH ROW
EXECUTE FUNCTION public.create_application_status_notification();