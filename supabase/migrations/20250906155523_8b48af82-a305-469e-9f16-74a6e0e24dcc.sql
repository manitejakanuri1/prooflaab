-- Add profile_photo_url column to college_profiles table
ALTER TABLE public.college_profiles 
ADD COLUMN profile_photo_url TEXT;