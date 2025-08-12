-- Fix the existing RLS policy that's blocking invite code creation
DROP POLICY IF EXISTS "Allow signup invite code creation" ON public.invite_codes;

-- Create a proper policy that allows authenticated users to create invite codes during signup
CREATE POLICY "Users can create invite codes during signup" 
ON public.invite_codes 
FOR INSERT 
TO authenticated 
WITH CHECK (
  -- Allow users to create invite codes for college_admin or startup roles
  role IN ('college_admin', 'startup') AND 
  created_by = auth.uid()
);

-- Create invite_codes validation table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.invite_codes_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  account_type app_role NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + interval '24 hours')
);

-- Enable RLS on the validation table
ALTER TABLE public.invite_codes_validation ENABLE ROW LEVEL SECURITY;

-- Policy for reading invite codes validation (anyone can validate)
CREATE POLICY "Anyone can validate invite codes" 
ON public.invite_codes_validation 
FOR SELECT 
TO authenticated 
USING (is_active = true AND expires_at > now());

-- Policy for creating invite codes validation (admins only)
CREATE POLICY "Admins can create invite code validations" 
ON public.invite_codes_validation 
FOR INSERT 
TO authenticated 
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Add rate limiting table for signup attempts
CREATE TABLE IF NOT EXISTS public.signup_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address inet NOT NULL,
  attempt_count integer DEFAULT 1,
  window_start timestamp with time zone DEFAULT now(),
  blocked_until timestamp with time zone
);

-- Enable RLS on rate limits table
ALTER TABLE public.signup_rate_limits ENABLE ROW LEVEL SECURITY;

-- Only system can manage rate limits
CREATE POLICY "System manages rate limits" 
ON public.signup_rate_limits 
FOR ALL 
TO authenticated 
USING (false);