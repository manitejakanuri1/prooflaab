-- Fix critical security vulnerability: Admin access codes exposed publicly
-- Replace public access with secure, time-limited verification

-- First, invalidate existing exposed admin codes by marking them as used
UPDATE public.invite_codes 
SET is_used = true
WHERE code IN ('ADMIN2024', 'COLLEGE2024', 'STARTUP2024');

-- Drop the dangerous public policy
DROP POLICY IF EXISTS "Anyone can verify invite codes" ON public.invite_codes;

-- Create secure policy that only allows verification during signup process
-- This restricts access to authenticated users only for valid codes
CREATE POLICY "Secure invite code verification" 
ON public.invite_codes 
FOR SELECT 
USING (
  -- Only allow reading by authenticated users for valid codes
  auth.uid() IS NOT NULL 
  AND NOT is_used 
  AND expires_at > now()
);

-- Create a secure function for invite code validation that doesn't expose codes
CREATE OR REPLACE FUNCTION public.validate_invite_code_secure(_code text, _role app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  invite_record record;
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
      'valid', false,
      'message', 'Invalid or expired invite code'
    );
  END IF;
  
  -- Return validation result without exposing sensitive data
  RETURN jsonb_build_object(
    'valid', true,
    'role', invite_record.role,
    'expires_at', invite_record.expires_at
  );
END;
$$;

-- Create new secure admin codes with expiration (30 days from now)
INSERT INTO public.invite_codes (code, role, expires_at) VALUES
('SECURE_ADMIN_' || extract(epoch from now())::bigint::text, 'admin', now() + interval '30 days'),
('SECURE_COLLEGE_' || extract(epoch from now())::bigint::text, 'college_admin', now() + interval '30 days'),
('SECURE_STARTUP_' || extract(epoch from now())::bigint::text, 'startup', now() + interval '30 days');

-- Add audit logging for invite code usage
CREATE OR REPLACE FUNCTION public.log_invite_code_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Log when invite codes are used
  IF OLD.is_used = false AND NEW.is_used = true THEN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
    VALUES (
      NEW.used_by,
      'INVITE_CODE_USED',
      'invite_codes',
      NEW.id,
      jsonb_build_object(
        'code', NEW.code,
        'role', NEW.role,
        'used_at', now()
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger for invite code usage logging
DROP TRIGGER IF EXISTS log_invite_code_usage_trigger ON public.invite_codes;
CREATE TRIGGER log_invite_code_usage_trigger
AFTER UPDATE ON public.invite_codes
FOR EACH ROW
EXECUTE FUNCTION public.log_invite_code_usage();