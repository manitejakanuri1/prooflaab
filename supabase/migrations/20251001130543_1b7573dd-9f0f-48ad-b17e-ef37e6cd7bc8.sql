-- Update existing student records to use proper capitalization for source
UPDATE public.student_profiles 
SET source = 'College' 
WHERE source = 'college';