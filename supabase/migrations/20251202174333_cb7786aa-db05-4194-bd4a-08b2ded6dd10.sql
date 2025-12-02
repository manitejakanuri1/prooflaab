-- Create recruiter_interests table
CREATE TABLE public.recruiter_interests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.proof_posts(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  recruiter_email text NOT NULL,
  message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.recruiter_interests ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (recruiters don't need to be logged in)
CREATE POLICY "Anyone can submit recruiter interest"
ON public.recruiter_interests
FOR INSERT
WITH CHECK (true);

-- Students can view interests for their own posts
CREATE POLICY "Students can view their own recruiter interests"
ON public.recruiter_interests
FOR SELECT
USING (student_id IN (
  SELECT id FROM student_profiles WHERE user_id = auth.uid()
));

-- Create trigger function to send notification to student
CREATE OR REPLACE FUNCTION public.notify_student_recruiter_interest()
RETURNS TRIGGER AS $$
DECLARE
  post_title text;
BEGIN
  -- Get the post title
  SELECT title INTO post_title FROM proof_posts WHERE id = NEW.post_id;
  
  -- Insert notification for the student
  INSERT INTO social_notifications (user_id, type, message, post_id, triggered_by)
  SELECT 
    sp.user_id,
    'recruiter_interest',
    '📩 A recruiter is interested in your project: ' || COALESCE(post_title, 'Untitled'),
    NEW.post_id,
    NULL
  FROM student_profiles sp
  WHERE sp.id = NEW.student_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
CREATE TRIGGER on_recruiter_interest_created
AFTER INSERT ON public.recruiter_interests
FOR EACH ROW
EXECUTE FUNCTION public.notify_student_recruiter_interest();

-- Add index for performance
CREATE INDEX idx_recruiter_interests_post_id ON public.recruiter_interests(post_id);
CREATE INDEX idx_recruiter_interests_student_id ON public.recruiter_interests(student_id);