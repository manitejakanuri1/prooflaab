
-- Create notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create policy for students to view their own notifications
CREATE POLICY "Students can view their own notifications" 
  ON public.notifications 
  FOR SELECT 
  USING (student_id IN (
    SELECT id FROM public.student_profiles 
    WHERE user_id = auth.uid()
  ));

-- Create policy for students to update their own notifications (mark as read)
CREATE POLICY "Students can update their own notifications" 
  ON public.notifications 
  FOR UPDATE 
  USING (student_id IN (
    SELECT id FROM public.student_profiles 
    WHERE user_id = auth.uid()
  ));

-- Insert sample notifications for testing
-- First, get a sample student_id (replace with actual student_id from your student_profiles table)
INSERT INTO public.notifications (student_id, type, message, is_read, created_at) VALUES
-- You'll need to replace 'YOUR_STUDENT_ID_HERE' with an actual student_id from your student_profiles table
((SELECT id FROM public.student_profiles LIMIT 1), 'task', 'New task assigned: "API Integration"', false, now() - interval '1 hour'),
((SELECT id FROM public.student_profiles LIMIT 1), 'feedback', 'Your proof for "UI Design" is under review', false, now() - interval '2 hours'),
((SELECT id FROM public.student_profiles LIMIT 1), 'achievement', 'Feedback received on "Landing Page Clone"', true, now() - interval '1 day');
