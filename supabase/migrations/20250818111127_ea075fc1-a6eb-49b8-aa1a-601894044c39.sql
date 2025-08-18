-- Fix email confirmation requirement and update auth settings
-- We'll set email confirmation as required in the auth settings through policies

-- First, let's ensure proper RLS policies for email confirmation
-- Update auth.users access to require email confirmation

-- Create a function to check if email confirmation is required
CREATE OR REPLACE FUNCTION public.is_email_confirmed(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT email_confirmed_at IS NOT NULL 
  FROM auth.users 
  WHERE id = user_id;
$$;

-- Update user_roles policies to ensure email confirmation
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
CREATE POLICY "Users can view their own role" 
ON public.user_roles 
FOR SELECT 
USING (
  auth.uid() = user_id 
  AND public.is_email_confirmed(auth.uid())
);

-- Update students table policies to require email confirmation
DROP POLICY IF EXISTS "Users can view their own student record" ON public.students;
CREATE POLICY "Users can view their own student record" 
ON public.students 
FOR SELECT 
USING (
  auth.uid() = user_id 
  AND public.is_email_confirmed(auth.uid())
);

DROP POLICY IF EXISTS "Users can update their own student record" ON public.students;
CREATE POLICY "Users can update their own student record" 
ON public.students 
FOR UPDATE 
USING (
  auth.uid() = user_id 
  AND public.is_email_confirmed(auth.uid())
);

-- Update colleges table policies to require email confirmation
DROP POLICY IF EXISTS "Users can view their own college record" ON public.colleges;
CREATE POLICY "Users can view their own college record" 
ON public.colleges 
FOR SELECT 
USING (
  auth.uid() = user_id 
  AND public.is_email_confirmed(auth.uid())
);

DROP POLICY IF EXISTS "Users can update their own college record" ON public.colleges;
CREATE POLICY "Users can update their own college record" 
ON public.colleges 
FOR UPDATE 
USING (
  auth.uid() = user_id 
  AND public.is_email_confirmed(auth.uid())
);

-- Update startups table policies to require email confirmation
DROP POLICY IF EXISTS "Users can view their own startup record" ON public.startups;
CREATE POLICY "Users can view their own startup record" 
ON public.startups 
FOR SELECT 
USING (
  auth.uid() = user_id 
  AND public.is_email_confirmed(auth.uid())
);

DROP POLICY IF EXISTS "Users can update their own startup record" ON public.startups;
CREATE POLICY "Users can update their own startup record" 
ON public.startups 
FOR UPDATE 
USING (
  auth.uid() = user_id 
  AND public.is_email_confirmed(auth.uid())
);

-- Create a function to verify invite codes and update status
CREATE OR REPLACE FUNCTION public.verify_invite_code_and_activate(
  _code text,
  _user_id uuid,
  _role app_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invite_record record;
  result jsonb;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO invite_record 
  FROM public.invite_codes 
  WHERE code = _code 
    AND role = _role 
    AND NOT is_used 
    AND expires_at > now();
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Invalid or expired invite code'
    );
  END IF;
  
  -- Mark code as used
  UPDATE public.invite_codes 
  SET is_used = true, used_by = _user_id
  WHERE id = invite_record.id;
  
  -- Update the appropriate table based on role
  IF _role = 'college_admin' THEN
    UPDATE public.colleges 
    SET status = 'active', invite_code = _code
    WHERE user_id = _user_id;
  ELSIF _role = 'startup' THEN
    UPDATE public.startups 
    SET status = 'active', invite_code = _code
    WHERE user_id = _user_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Invite code verified and account activated'
  );
END;
$$;