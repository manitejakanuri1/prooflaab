-- Add fields to tasks table for task acknowledgment and time tracking
ALTER TABLE public.tasks 
ADD COLUMN started_at timestamp with time zone,
ADD COLUMN duration_days integer DEFAULT 7,
ADD COLUMN upload_deadline timestamp with time zone;

-- Update existing sample task with duration
UPDATE public.tasks 
SET duration_days = 7 
WHERE title = 'Build React Dashboard';

-- Create function to calculate upload deadline when task is started
CREATE OR REPLACE FUNCTION public.calculate_upload_deadline()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Set upload deadline when task is started
  IF OLD.started_at IS NULL AND NEW.started_at IS NOT NULL THEN
    NEW.upload_deadline := NEW.started_at + (NEW.duration_days || ' days')::interval;
    NEW.status := 'In Progress';
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create trigger to automatically set upload deadline when task is started
CREATE TRIGGER set_upload_deadline
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.calculate_upload_deadline();