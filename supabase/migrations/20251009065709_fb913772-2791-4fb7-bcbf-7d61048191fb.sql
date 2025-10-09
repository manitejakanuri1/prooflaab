-- Temporarily disable the validate_task trigger
ALTER TABLE tasks DISABLE TRIGGER validate_task_trigger;

-- First, update the trigger functions to use 'In Progress' instead of 'Assigned'
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
  -- If created by admin, set to In Progress (Active)
  IF NEW.created_by_admin_id IS NOT NULL THEN
    NEW.status := 'In Progress';
    RETURN NEW;
  END IF;

  -- If created by college, check if college is verified
  IF NEW.created_by_college_id IS NOT NULL THEN
    SELECT (verification_status = 'approved') INTO college_verified
    FROM public.colleges
    WHERE id = NEW.created_by_college_id;
    
    IF college_verified THEN
      NEW.status := 'In Progress';
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
      NEW.status := 'In Progress';
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
    SET status = 'In Progress', updated_at = now()
    WHERE created_by_college_id = NEW.id 
      AND status = 'Pending';
  END IF;

  -- Update tasks when startup is verified
  IF TG_TABLE_NAME = 'startups' AND OLD.verification_status != 'approved' AND NEW.verification_status = 'approved' THEN
    UPDATE public.tasks
    SET status = 'In Progress', updated_at = now()
    WHERE created_by_startup_id = NEW.user_id 
      AND status = 'Pending';
  END IF;

  RETURN NEW;
END;
$$;

-- Now backfill existing tasks with correct creator info and status
-- Update admin-created tasks
UPDATE tasks
SET 
  approved_by_admin = TRUE, 
  status = 'In Progress',
  source = COALESCE(source, 'admin'),
  updated_at = now()
WHERE created_by_admin_id IS NOT NULL;

-- Update college-created tasks with verified colleges
UPDATE tasks t
SET 
  approved_by_admin = TRUE, 
  status = 'In Progress',
  source = COALESCE(t.source, 'college'),
  updated_at = now()
FROM colleges c
WHERE t.created_by_college_id = c.id 
  AND c.verification_status = 'approved';

-- Update college-created tasks with unverified colleges
UPDATE tasks t
SET 
  approved_by_admin = FALSE, 
  status = 'Pending',
  source = COALESCE(t.source, 'college'),
  updated_at = now()
FROM colleges c
WHERE t.created_by_college_id = c.id 
  AND c.verification_status != 'approved';

-- Update startup-created tasks with verified startups
UPDATE tasks t
SET 
  approved_by_admin = TRUE, 
  status = 'In Progress',
  source = COALESCE(t.source, 'startup'),
  updated_at = now()
FROM startups s
WHERE t.created_by_startup_id = s.user_id 
  AND s.verification_status = 'approved';

-- Update startup-created tasks with unverified startups
UPDATE tasks t
SET 
  approved_by_admin = FALSE, 
  status = 'Pending',
  source = COALESCE(t.source, 'startup'),
  updated_at = now()
FROM startups s
WHERE t.created_by_startup_id = s.user_id 
  AND s.verification_status != 'approved';

-- Set default source for tasks without any creator (edge case)
UPDATE tasks
SET 
  source = COALESCE(source, 'manual'),
  updated_at = now()
WHERE created_by_admin_id IS NULL 
  AND created_by_college_id IS NULL 
  AND created_by_startup_id IS NULL;

-- Re-enable the validate_task trigger
ALTER TABLE tasks ENABLE TRIGGER validate_task_trigger;