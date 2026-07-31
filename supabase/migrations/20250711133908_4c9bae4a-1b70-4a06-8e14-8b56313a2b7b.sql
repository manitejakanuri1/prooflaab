-- Fix the proof submission notification trigger to include title
CREATE OR REPLACE FUNCTION public.create_proof_submission_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
  VALUES (
    NEW.student_id,
    'proof',
    'Proof Submitted',
    'You submitted a proof for: "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '"',
    false,
    now()
  );
  RETURN NEW;
END;
$function$;