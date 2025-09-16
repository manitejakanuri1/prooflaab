-- Add profile_completed column to student_profiles table
ALTER TABLE public.student_profiles 
ADD COLUMN profile_completed boolean NOT NULL DEFAULT false;