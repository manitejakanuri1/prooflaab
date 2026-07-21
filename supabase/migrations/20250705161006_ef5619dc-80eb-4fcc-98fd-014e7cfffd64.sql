
-- Create table to store OTP codes for student verification
CREATE TABLE IF NOT EXISTS public.student_otps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_used BOOLEAN NOT NULL DEFAULT false
);

-- Add index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_student_otps_email ON public.student_otps(email);

-- Add index on created_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_student_otps_created_at ON public.student_otps(created_at);

-- Enable Row Level Security
ALTER TABLE public.student_otps ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public insert (for OTP generation)
CREATE POLICY "Allow public insert for OTP generation" 
  ON public.student_otps 
  FOR INSERT 
  WITH CHECK (true);

-- Create policy to allow public select (for OTP verification)
CREATE POLICY "Allow public select for OTP verification" 
  ON public.student_otps 
  FOR SELECT 
  USING (true);

-- Create policy to allow public update (for marking OTP as used)
CREATE POLICY "Allow public update for marking OTP as used" 
  ON public.student_otps 
  FOR UPDATE 
  USING (true) 
  WITH CHECK (true);
