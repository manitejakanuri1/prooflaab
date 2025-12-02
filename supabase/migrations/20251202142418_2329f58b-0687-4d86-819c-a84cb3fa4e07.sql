-- Add contact information fields to student_profiles
ALTER TABLE public.student_profiles
ADD COLUMN IF NOT EXISTS linkedin_url text,
ADD COLUMN IF NOT EXISTS github_url text,
ADD COLUMN IF NOT EXISTS resume_url text;

-- Add comments for documentation
COMMENT ON COLUMN public.student_profiles.linkedin_url IS 'LinkedIn profile URL for recruiter contact';
COMMENT ON COLUMN public.student_profiles.github_url IS 'GitHub profile URL for recruiter contact';
COMMENT ON COLUMN public.student_profiles.resume_url IS 'Resume/CV URL for recruiter download';