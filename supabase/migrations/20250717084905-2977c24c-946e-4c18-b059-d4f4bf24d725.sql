-- Make user_id nullable in student_profiles table to allow creation before auth signup
ALTER TABLE public.student_profiles 
ALTER COLUMN user_id DROP NOT NULL;

-- Add a temporary_user_id column for tracking before auth creation
ALTER TABLE public.student_profiles 
ADD COLUMN temporary_user_id uuid DEFAULT gen_random_uuid();

-- Create index for better performance on temporary_user_id
CREATE INDEX idx_student_profiles_temporary_user_id ON public.student_profiles(temporary_user_id);