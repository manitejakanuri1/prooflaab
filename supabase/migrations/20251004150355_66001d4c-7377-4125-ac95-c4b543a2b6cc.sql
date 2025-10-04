-- Allow admins to view all student profiles
CREATE POLICY "Admins can view all student profiles"
ON public.student_profiles
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
);