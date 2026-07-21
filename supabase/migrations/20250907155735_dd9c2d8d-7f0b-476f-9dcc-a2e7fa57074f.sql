-- Add college_id column to student_profiles table to link students to colleges
ALTER TABLE public.student_profiles 
ADD COLUMN college_id uuid REFERENCES public.colleges(id);

-- Update existing student_profiles to link with colleges based on students table
UPDATE public.student_profiles 
SET college_id = s.college_id 
FROM public.students s 
WHERE public.student_profiles.user_id = s.user_id 
AND s.college_id IS NOT NULL;

-- Create index for better performance on college queries
CREATE INDEX IF NOT EXISTS idx_student_profiles_college_id ON public.student_profiles(college_id);

-- Add RLS policy to ensure college admins can only see their students
CREATE POLICY "College admins can view their students" 
ON public.student_profiles 
FOR SELECT 
USING (
  college_id IN (
    SELECT id FROM public.colleges WHERE user_id = auth.uid()
  )
);

-- Add RLS policy for college admins to manage their students
CREATE POLICY "College admins can update their students" 
ON public.student_profiles 
FOR UPDATE 
USING (
  college_id IN (
    SELECT id FROM public.colleges WHERE user_id = auth.uid()
  )
);