-- Add branch and batch columns to student_profiles table
ALTER TABLE public.student_profiles 
ADD COLUMN branch text,
ADD COLUMN batch text;