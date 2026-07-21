-- Create student credits table
CREATE TABLE IF NOT EXISTS public.student_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  credits_available INTEGER NOT NULL DEFAULT 10,
  credits_used_today INTEGER NOT NULL DEFAULT 0,
  last_refreshed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  premium_status BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(student_id)
);

-- Enable RLS
ALTER TABLE public.student_credits ENABLE ROW LEVEL SECURITY;

-- RLS Policies for student_credits
CREATE POLICY "Students can view their own credits"
ON public.student_credits FOR SELECT
USING (student_id IN (
  SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
));

CREATE POLICY "Students can update their own credits"
ON public.student_credits FOR UPDATE
USING (student_id IN (
  SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
));

CREATE POLICY "Students can insert their own credits"
ON public.student_credits FOR INSERT
WITH CHECK (student_id IN (
  SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
));

CREATE POLICY "Admins can manage all credits"
ON public.student_credits FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add new columns to tasks table
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS created_by_type TEXT DEFAULT 'admin',
ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS suggested_xp INTEGER DEFAULT 50;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_tasks_created_by_type ON public.tasks(created_by_type);
CREATE INDEX IF NOT EXISTS idx_student_credits_student_id ON public.student_credits(student_id);

-- Function to initialize credits for new students
CREATE OR REPLACE FUNCTION public.initialize_student_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.student_credits (student_id, credits_available, credits_used_today, last_refreshed_at)
  VALUES (NEW.id, 10, 0, now())
  ON CONFLICT (student_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger to auto-create credits for new students
CREATE TRIGGER on_student_profile_created
AFTER INSERT ON public.student_profiles
FOR EACH ROW
EXECUTE FUNCTION public.initialize_student_credits();

-- Function to reset credits daily
CREATE OR REPLACE FUNCTION public.reset_daily_credits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.student_credits
  SET 
    credits_available = CASE 
      WHEN premium_status = true THEN 999
      ELSE 10
    END,
    credits_used_today = 0,
    last_refreshed_at = now(),
    updated_at = now()
  WHERE DATE(last_refreshed_at) < CURRENT_DATE;
END;
$$;

-- Update existing students with initial credits
INSERT INTO public.student_credits (student_id, credits_available, credits_used_today, last_refreshed_at)
SELECT id, 10, 0, now()
FROM public.student_profiles
ON CONFLICT (student_id) DO NOTHING;