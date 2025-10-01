-- Update all students with a college_id to have source = 'College'
-- These are students uploaded via CSV by colleges
UPDATE public.student_profiles 
SET source = 'College' 
WHERE college_id IS NOT NULL AND source = 'Website';

-- Keep source = 'Website' only for students who registered directly (college_id IS NULL)