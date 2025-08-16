-- Fix critical security vulnerability in student_otps table
-- Replace overly permissive RLS policies with proper email-based access control

-- Drop existing vulnerable policies
DROP POLICY IF EXISTS "Authenticated users can insert OTP" ON public.student_otps;
DROP POLICY IF EXISTS "Users can update their own OTP" ON public.student_otps;
DROP POLICY IF EXISTS "Users can verify their own OTP" ON public.student_otps;

-- Create secure policies that restrict access to email owner only
CREATE POLICY "Users can insert OTP for their own email" 
ON public.student_otps 
FOR INSERT 
WITH CHECK (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
);

CREATE POLICY "Users can update their own OTP" 
ON public.student_otps 
FOR UPDATE 
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
);

CREATE POLICY "Users can verify their own OTP" 
ON public.student_otps 
FOR SELECT 
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
);

-- Add rate limiting by cleaning up old OTP entries (security best practice)
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Delete OTP codes older than 10 minutes
  DELETE FROM public.student_otps 
  WHERE created_at < now() - interval '10 minutes';
END;
$$;