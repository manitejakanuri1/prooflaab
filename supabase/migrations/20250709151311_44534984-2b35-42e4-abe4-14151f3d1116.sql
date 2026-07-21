
-- Function to create task assignment notifications
CREATE OR REPLACE FUNCTION create_task_assignment_notification()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications (student_id, type, message, is_read, created_at)
  VALUES (
    NEW.student_id,
    'task',
    'New task assigned: "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '"',
    false,
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create proof submission notifications
CREATE OR REPLACE FUNCTION create_proof_submission_notification()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications (student_id, type, message, is_read, created_at)
  VALUES (
    NEW.student_id,
    'proof',
    'You submitted a proof for: "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '"',
    false,
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create proof review notifications
CREATE OR REPLACE FUNCTION create_proof_review_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create notification if status actually changed and is not null
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IS NOT NULL THEN
    INSERT INTO public.notifications (student_id, type, message, is_read, created_at)
    VALUES (
      NEW.student_id,
      'review',
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for task assignments (assuming you have an assigned_tasks table or similar)
-- Note: Since I see you have a tasks table with student_id, I'll create a trigger for new tasks
CREATE TRIGGER trigger_task_assignment_notification
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION create_task_assignment_notification();

-- Create trigger for proof submissions
CREATE TRIGGER trigger_proof_submission_notification
  AFTER INSERT ON public.proof_uploads
  FOR EACH ROW
  EXECUTE FUNCTION create_proof_submission_notification();

-- Create trigger for proof reviews
CREATE TRIGGER trigger_proof_review_notification
  AFTER UPDATE ON public.proof_uploads
  FOR EACH ROW
  EXECUTE FUNCTION create_proof_review_notification();

-- Function to create XP reward notifications
CREATE OR REPLACE FUNCTION create_xp_reward_notification()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications (student_id, type, message, is_read, created_at)
  VALUES (
    NEW.student_id,
    'achievement',
    'You earned ' || NEW.xp_points || ' XP points! 🎉',
    false,
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for XP rewards
CREATE TRIGGER trigger_xp_reward_notification
  AFTER INSERT ON public.xp_logs
  FOR EACH ROW
  EXECUTE FUNCTION create_xp_reward_notification();
