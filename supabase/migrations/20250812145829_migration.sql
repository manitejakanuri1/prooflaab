-- Create a function to validate invite codes more securely
CREATE OR REPLACE FUNCTION public.validate_and_use_invite_code(
  _code text,
  _account_type app_role,
  _user_id uuid
) RETURNS boolean
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
    AND account_type = _account_type 
    AND is_active = true 
    AND (expires_at IS NULL OR expires_at > now())
    AND used_by IS NULL;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Mark code as used
  UPDATE public.invite_codes 
  SET used_by = _user_id, used_at = now()
  WHERE id = invite_record.id;
  
  -- Assign role to user
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, _account_type)
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN true;
END;
$$;

-- Update the invite_codes_validation table structure to match usage
ALTER TABLE public.invite_codes_validation 
ADD COLUMN IF NOT EXISTS used_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS used_at timestamp with time zone;