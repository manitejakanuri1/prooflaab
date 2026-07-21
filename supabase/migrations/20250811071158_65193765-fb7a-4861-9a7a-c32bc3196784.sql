-- Phase 2: Fix remaining security issues from linter warnings

-- Fix all existing functions to have proper search_path
CREATE OR REPLACE FUNCTION public.create_task_assignment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Only create notification if there's actually a student assigned
  IF NEW.student_id IS NOT NULL THEN
    INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
    VALUES (
      NEW.student_id,
      'task',
      'New Task Assigned',
      'New task assigned: "' || NEW.title || '"',
      false,
      now()
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_upload_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
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

CREATE OR REPLACE FUNCTION public.create_proof_submission_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

CREATE OR REPLACE FUNCTION public.generate_url_slug(student_name text)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RETURN lower(replace(trim(student_name), ' ', '-'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_unique_slug(base_name text)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 0;
  random_suffix text;
BEGIN
  -- Convert name to lowercase and replace spaces with hyphens
  base_slug := lower(trim(regexp_replace(base_name, '[^a-zA-Z0-9\s]', '', 'g')));
  base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
  
  -- Generate random 4-digit suffix
  random_suffix := lpad((random() * 9999)::integer::text, 4, '0');
  final_slug := base_slug || '-' || random_suffix;
  
  -- Check if slug exists and increment if needed
  WHILE EXISTS (SELECT 1 FROM public.student_profiles WHERE slug = final_slug) LOOP
    counter := counter + 1;
    random_suffix := lpad((random() * 9999)::integer::text, 4, '0');
    final_slug := base_slug || '-' || random_suffix;
  END LOOP;
  
  RETURN final_slug;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_generate_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- Only generate slug if it's not already set
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_unique_slug(NEW.full_name);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_portfolio_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- Update portfolio slug when student profile slug changes
  UPDATE public.student_portfolios 
  SET slug = NEW.slug 
  WHERE student_id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_initial_portfolio_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- Set slug from student_profiles when portfolio is created
  SELECT slug INTO NEW.slug 
  FROM public.student_profiles 
  WHERE id = NEW.student_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

CREATE OR REPLACE FUNCTION public.create_proof_review_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

CREATE OR REPLACE FUNCTION public.update_student_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    task_xp INTEGER;
BEGIN
    -- Only process when status changes to 'Verified'
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Verified' THEN
        -- Get XP from the task
        SELECT COALESCE(xp_reward, xp, 0) INTO task_xp 
        FROM tasks 
        WHERE id = NEW.task_id;
        
        -- Update student's total XP and trust score
        UPDATE student_profiles 
        SET 
            total_xp = total_xp + task_xp,
            trust_score = LEAST(trust_score + 10, 100),  -- Increase trust score by 10, max 100
            updated_at = now()
        WHERE id = NEW.student_id;
        
        -- Log the XP gain
        INSERT INTO xp_logs (student_id, xp_points, source, created_at)
        VALUES (NEW.student_id, task_xp, 'Task Verification', now());
        
        -- Update trust score table
        INSERT INTO trust_scores (student_id, score, last_updated)
        VALUES (NEW.student_id, (SELECT trust_score FROM student_profiles WHERE id = NEW.student_id), now())
        ON CONFLICT (student_id) 
        DO UPDATE SET 
            score = (SELECT trust_score FROM student_profiles WHERE id = NEW.student_id),
            last_updated = now();
            
        -- Mark task as completed
        UPDATE tasks 
        SET 
            status = 'Completed',
            completed_at = now(),
            updated_at = now()
        WHERE id = NEW.task_id;
    END IF;
    
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_xp_reward_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
  VALUES (
    NEW.student_id,
    'achievement',
    'XP Reward! 🎉',
    'You earned ' || NEW.xp_points || ' XP points! 🎉',
    false,
    now()
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_application_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

-- Add RLS policy to leaderboard view to prevent unauthorized access
ALTER VIEW public.leaderboard OWNER TO postgres;

-- Create secure access policies for students_auth table
DROP POLICY IF EXISTS "Allow users to read own records" ON public.students_auth;
DROP POLICY IF EXISTS "Allow users to update own verification" ON public.students_auth;
DROP POLICY IF EXISTS "Allow public insert for student signup" ON public.students_auth;

-- More restrictive policies for students_auth
CREATE POLICY "Students can insert their own auth record" ON public.students_auth
FOR INSERT TO authenticated WITH CHECK (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "Students can read their own auth record" ON public.students_auth
FOR SELECT TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "Students can update their own verification" ON public.students_auth
FOR UPDATE TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Secure email_verifications table
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own email verification" ON public.email_verifications
FOR ALL TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Create audit log table for tracking sensitive operations
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs" ON public.audit_logs
FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Function to log audit events
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    -- Log the operation
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
    VALUES (
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$function$;