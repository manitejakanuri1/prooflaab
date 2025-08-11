-- Fix the remaining security issues

-- Remove the security definer view and create a proper secure function instead
DROP VIEW IF EXISTS public.leaderboard;

-- Create a secure function to replace the leaderboard view
CREATE OR REPLACE FUNCTION public.get_leaderboard(_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  total_xp INTEGER,
  trust_score INTEGER,
  rank BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 
    sp.id,
    sp.full_name,
    sp.total_xp,
    sp.trust_score,
    ROW_NUMBER() OVER (ORDER BY sp.total_xp DESC) as rank
  FROM public.student_profiles sp
  WHERE sp.total_xp > 0
  ORDER BY sp.total_xp DESC
  LIMIT _limit;
$$;

-- Create audit triggers for sensitive tables
CREATE TRIGGER audit_student_profiles
    AFTER INSERT OR UPDATE OR DELETE ON public.student_profiles
    FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_tasks
    AFTER INSERT OR UPDATE OR DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_proof_uploads
    AFTER INSERT OR UPDATE OR DELETE ON public.proof_uploads
    FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- Add rate limiting table for authentication attempts
CREATE TABLE public.auth_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL, -- IP address or email
    attempt_count INTEGER DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    blocked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on rate limits
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

-- Only system can manage rate limits
CREATE POLICY "System can manage rate limits" ON public.auth_rate_limits
FOR ALL USING (false); -- No direct user access

-- Function to check and update rate limits
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    _identifier TEXT,
    _max_attempts INTEGER DEFAULT 5,
    _window_minutes INTEGER DEFAULT 15
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_attempts INTEGER;
    window_start TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Clean up old entries
    DELETE FROM public.auth_rate_limits 
    WHERE window_start < now() - (_window_minutes || ' minutes')::interval;
    
    -- Get current attempts for this identifier
    SELECT attempt_count, auth_rate_limits.window_start 
    INTO current_attempts, window_start
    FROM public.auth_rate_limits 
    WHERE identifier = _identifier 
    AND window_start > now() - (_window_minutes || ' minutes')::interval;
    
    -- If no record exists, create one
    IF current_attempts IS NULL THEN
        INSERT INTO public.auth_rate_limits (identifier, attempt_count)
        VALUES (_identifier, 1);
        RETURN TRUE;
    END IF;
    
    -- Check if limit exceeded
    IF current_attempts >= _max_attempts THEN
        RETURN FALSE;
    END IF;
    
    -- Increment attempt count
    UPDATE public.auth_rate_limits 
    SET attempt_count = attempt_count + 1
    WHERE identifier = _identifier;
    
    RETURN TRUE;
END;
$$;

-- Create input validation functions
CREATE OR REPLACE FUNCTION public.validate_email(_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    RETURN _email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_task_title(_title TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    RETURN length(trim(_title)) >= 3 AND length(trim(_title)) <= 200;
END;
$$;

-- Add validation triggers
CREATE OR REPLACE FUNCTION public.validate_student_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Validate email
    IF NOT public.validate_email(NEW.email) THEN
        RAISE EXCEPTION 'Invalid email format';
    END IF;
    
    -- Validate full name
    IF length(trim(NEW.full_name)) < 2 OR length(trim(NEW.full_name)) > 100 THEN
        RAISE EXCEPTION 'Full name must be between 2 and 100 characters';
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_student_profile_trigger
    BEFORE INSERT OR UPDATE ON public.student_profiles
    FOR EACH ROW EXECUTE FUNCTION public.validate_student_profile();

CREATE OR REPLACE FUNCTION public.validate_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Validate title
    IF NOT public.validate_task_title(NEW.title) THEN
        RAISE EXCEPTION 'Task title must be between 3 and 200 characters';
    END IF;
    
    -- Validate due date is in future
    IF NEW.due_date <= now() THEN
        RAISE EXCEPTION 'Due date must be in the future';
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_task_trigger
    BEFORE INSERT OR UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.validate_task();

-- Create function to safely get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID DEFAULT auth.uid())
RETURNS app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
$$;

-- Initialize default roles for existing users (run once)
-- This will assign 'student' role to users who have student profiles
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT sp.user_id, 'student'::app_role
FROM public.student_profiles sp
WHERE sp.user_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = sp.user_id
)
ON CONFLICT (user_id, role) DO NOTHING;