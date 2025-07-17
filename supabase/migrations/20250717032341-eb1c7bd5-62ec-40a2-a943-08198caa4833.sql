-- Add admin policies for student_profiles table to allow college administrators to create student profiles
CREATE POLICY "College admins can insert student profiles" 
ON public.student_profiles 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "College admins can view all student profiles" 
ON public.student_profiles 
FOR SELECT 
USING (true);

CREATE POLICY "College admins can update all student profiles" 
ON public.student_profiles 
FOR UPDATE 
USING (true);