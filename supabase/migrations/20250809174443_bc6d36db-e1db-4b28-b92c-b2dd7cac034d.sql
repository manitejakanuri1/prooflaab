-- Fix security definer functions by setting proper search path
ALTER FUNCTION public.create_application_notification() SET search_path = '';
ALTER FUNCTION public.create_application_status_notification() SET search_path = '';

-- Fix the notification function that incorrectly assumes startup has a student profile
-- Startups don't have student profiles, so we need to create a separate notifications table for startups
CREATE TABLE IF NOT EXISTS public.startup_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  startup_user_id UUID NOT NULL,
  type TEXT DEFAULT 'general',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for startup notifications
ALTER TABLE public.startup_notifications ENABLE ROW LEVEL SECURITY;

-- RLS policies for startup notifications
CREATE POLICY "Startups can view their own notifications" 
ON public.startup_notifications 
FOR SELECT 
USING (startup_user_id = auth.uid());

CREATE POLICY "Startups can update their own notifications" 
ON public.startup_notifications 
FOR UPDATE 
USING (startup_user_id = auth.uid());

-- Recreate the application notification function correctly
CREATE OR REPLACE FUNCTION public.create_application_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Create notification for startup (not student)
  INSERT INTO public.startup_notifications (
    startup_user_id, 
    type, 
    title, 
    message, 
    is_read, 
    created_at
  )
  SELECT 
    t.created_by_startup_id,
    'application',
    'New Task Application',
    'A student applied for your task: "' || t.title || '"',
    false,
    now()
  FROM public.tasks t
  WHERE t.id = NEW.task_id;
  
  RETURN NEW;
END;
$function$;