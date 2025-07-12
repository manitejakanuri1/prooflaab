-- Add review-related fields to proof_uploads table
ALTER TABLE public.proof_uploads ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE public.proof_uploads ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE public.proof_uploads ADD COLUMN IF NOT EXISTS moss_status TEXT CHECK (moss_status IN ('Pending', 'Unique', 'Similar', 'Suspicious'));
ALTER TABLE public.proof_uploads ADD COLUMN IF NOT EXISTS moss_url TEXT;
ALTER TABLE public.proof_uploads ADD COLUMN IF NOT EXISTS moss_score DECIMAL(5,2);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_proof_uploads_status ON public.proof_uploads(status);
CREATE INDEX IF NOT EXISTS idx_proof_uploads_submitted_at ON public.proof_uploads(submitted_at);

-- Add RLS policies for admin access to proof uploads
CREATE POLICY "Admins can view all proof uploads" 
ON public.proof_uploads 
FOR SELECT 
TO authenticated
USING (true); -- We'll implement proper admin role checking later

CREATE POLICY "Admins can update proof uploads" 
ON public.proof_uploads 
FOR UPDATE 
TO authenticated
USING (true); -- We'll implement proper admin role checking later

-- Create notification for status updates
CREATE OR REPLACE FUNCTION public.notify_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Only create notification if status changed to Verified or Rejected
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('Verified', 'Rejected') THEN
    INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
    VALUES (
      NEW.student_id,
      'review',
      CASE 
        WHEN NEW.status = 'Verified' THEN 'Task Verified ✅'
        WHEN NEW.status = 'Rejected' THEN 'Task Rejected ❌'
      END,
      CASE 
        WHEN NEW.status = 'Verified' THEN 'Your proof for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" has been verified!'
        WHEN NEW.status = 'Rejected' THEN 'Your proof for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was rejected. ' || COALESCE('Reason: ' || NEW.review_comment, '')
      END,
      false,
      now()
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Create trigger for status update notifications
DROP TRIGGER IF EXISTS proof_status_update_notification ON public.proof_uploads;
CREATE TRIGGER proof_status_update_notification
  AFTER UPDATE ON public.proof_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_status_update();