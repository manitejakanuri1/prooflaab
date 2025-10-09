-- Function to automatically set task status based on creator verification
CREATE OR REPLACE FUNCTION public.set_task_status_based_on_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  college_verified BOOLEAN;
  startup_verified BOOLEAN;
BEGIN
  -- If created by admin, set to Active
  IF NEW.created_by_admin_id IS NOT NULL THEN
    NEW.status := 'Assigned';
    RETURN NEW;
  END IF;

  -- If created by college, check if college is verified
  IF NEW.created_by_college_id IS NOT NULL THEN
    SELECT (verification_status = 'approved') INTO college_verified
    FROM public.colleges
    WHERE id = NEW.created_by_college_id;
    
    IF college_verified THEN
      NEW.status := 'Assigned';
    ELSE
      NEW.status := 'Pending';
    END IF;
    
    RETURN NEW;
  END IF;

  -- If created by startup, check if startup is verified
  IF NEW.created_by_startup_id IS NOT NULL THEN
    SELECT (verification_status = 'approved') INTO startup_verified
    FROM public.startups
    WHERE user_id = NEW.created_by_startup_id;
    
    IF startup_verified THEN
      NEW.status := 'Assigned';
    ELSE
      NEW.status := 'Pending';
    END IF;
    
    RETURN NEW;
  END IF;

  -- Default to Pending if no creator is identified
  NEW.status := 'Pending';
  RETURN NEW;
END;
$$;

-- Drop trigger if exists to avoid conflicts
DROP TRIGGER IF EXISTS trigger_set_task_status_on_insert ON public.tasks;

-- Create trigger to run before insert on tasks
CREATE TRIGGER trigger_set_task_status_on_insert
BEFORE INSERT ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.set_task_status_based_on_verification();

-- Also create a trigger to update task status when college/startup verification changes
CREATE OR REPLACE FUNCTION public.update_task_status_on_verification_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update tasks when college is verified
  IF TG_TABLE_NAME = 'colleges' AND OLD.verification_status != 'approved' AND NEW.verification_status = 'approved' THEN
    UPDATE public.tasks
    SET status = 'Assigned', updated_at = now()
    WHERE created_by_college_id = NEW.id 
      AND status = 'Pending';
  END IF;

  -- Update tasks when startup is verified
  IF TG_TABLE_NAME = 'startups' AND OLD.verification_status != 'approved' AND NEW.verification_status = 'approved' THEN
    UPDATE public.tasks
    SET status = 'Assigned', updated_at = now()
    WHERE created_by_startup_id = NEW.user_id 
      AND status = 'Pending';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop triggers if exists
DROP TRIGGER IF EXISTS trigger_update_tasks_on_college_verification ON public.colleges;
DROP TRIGGER IF EXISTS trigger_update_tasks_on_startup_verification ON public.startups;

-- Create triggers for college and startup verification changes
CREATE TRIGGER trigger_update_tasks_on_college_verification
AFTER UPDATE ON public.colleges
FOR EACH ROW
WHEN (OLD.verification_status IS DISTINCT FROM NEW.verification_status)
EXECUTE FUNCTION public.update_task_status_on_verification_change();

CREATE TRIGGER trigger_update_tasks_on_startup_verification
AFTER UPDATE ON public.startups
FOR EACH ROW
WHEN (OLD.verification_status IS DISTINCT FROM NEW.verification_status)
EXECUTE FUNCTION public.update_task_status_on_verification_change();