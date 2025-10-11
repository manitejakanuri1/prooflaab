-- Fix all trigger functions that reference the tasks table to have correct search_path

-- Fix create_proof_submission_notification
CREATE OR REPLACE FUNCTION public.create_proof_submission_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Fix notify_status_update
CREATE OR REPLACE FUNCTION public.notify_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Fix create_proof_review_notification
CREATE OR REPLACE FUNCTION public.create_proof_review_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Fix create_application_status_notification
CREATE OR REPLACE FUNCTION public.create_application_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Fix create_application_notification
CREATE OR REPLACE FUNCTION public.create_application_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;