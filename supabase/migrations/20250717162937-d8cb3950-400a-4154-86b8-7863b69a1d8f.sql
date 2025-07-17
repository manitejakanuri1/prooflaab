-- Fix the proof review notification function to include title
CREATE OR REPLACE FUNCTION public.create_proof_review_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Only create notification if status actually changed and is not null
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IS NOT NULL THEN
    INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
    VALUES (
      NEW.student_id,
      'review',
      CASE 
        WHEN NEW.status = 'Verified' THEN 'Task Verified ✅'
        WHEN NEW.status = 'Rejected' THEN 'Task Rejected ❌'
        ELSE 'Task Status Updated'
      END,
      CASE 
        WHEN NEW.status = 'Verified' THEN 'Your proof for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was verified ✅'
        WHEN NEW.status = 'Rejected' THEN 'Your proof for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was rejected ❌'
        ELSE 'Your proof for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" status was updated'
      END,
      false,
      now()
    );
  END IF;
  RETURN NEW;
END;
$function$;