-- Add RLS policies for xp_logs table to allow admin operations

-- Enable RLS on xp_logs if not already enabled
ALTER TABLE public.xp_logs ENABLE ROW LEVEL SECURITY;

-- Allow admins to insert XP logs for any student
CREATE POLICY "Admins can insert XP logs"
ON public.xp_logs
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role) OR
  public.has_role(auth.uid(), 'college_admin'::public.app_role)
);

-- Allow admins to view all XP logs
CREATE POLICY "Admins can view all XP logs"
ON public.xp_logs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role) OR
  public.has_role(auth.uid(), 'college_admin'::public.app_role)
);

-- Allow students to view their own XP logs
CREATE POLICY "Students can view their own XP logs"
ON public.xp_logs
FOR SELECT
TO authenticated
USING (
  student_id IN (
    SELECT id FROM public.student_profiles WHERE user_id = auth.uid()
  )
);