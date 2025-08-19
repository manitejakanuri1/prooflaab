-- Create announcements table
CREATE TABLE public.announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_by_admin UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create manual_adjustment_log table
CREATE TABLE public.manual_adjustment_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL,
  admin_id UUID NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('XP', 'Trust')),
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create admin_users table
CREATE TABLE public.admin_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('super', 'moderator')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add new columns to existing tables
ALTER TABLE public.proof_uploads 
ADD COLUMN IF NOT EXISTS admin_review_status TEXT DEFAULT 'Pending' CHECK (admin_review_status IN ('Pending', 'Verified', 'Rejected'));

ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS approved_by_admin BOOLEAN DEFAULT true;

ALTER TABLE public.student_profiles 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'suspended'));

ALTER TABLE public.startups 
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'suspended'));

ALTER TABLE public.colleges 
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'suspended'));

ALTER TABLE public.job_opportunities 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual' CHECK (source IN ('ai', 'manual'));

ALTER TABLE public.job_opportunities 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.learning_resources 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual' CHECK (source IN ('ai', 'manual'));

ALTER TABLE public.learning_resources 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected'));

-- Enable RLS on new tables
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_adjustment_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for announcements
CREATE POLICY "Admins can manage announcements" 
ON public.announcements 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "All authenticated users can view announcements" 
ON public.announcements 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Create RLS policies for manual_adjustment_log
CREATE POLICY "Admins can manage adjustment logs" 
ON public.manual_adjustment_log 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create RLS policies for admin_users
CREATE POLICY "Admins can manage admin users" 
ON public.admin_users 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create indexes for better performance
CREATE INDEX idx_announcements_created_at ON public.announcements(created_at);
CREATE INDEX idx_manual_adjustment_log_student_id ON public.manual_adjustment_log(student_id);
CREATE INDEX idx_manual_adjustment_log_created_at ON public.manual_adjustment_log(created_at);
CREATE INDEX idx_admin_users_email ON public.admin_users(email);

-- Create updated_at trigger for announcements
CREATE TRIGGER update_announcements_updated_at
BEFORE UPDATE ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create updated_at trigger for admin_users
CREATE TRIGGER update_admin_users_updated_at
BEFORE UPDATE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();