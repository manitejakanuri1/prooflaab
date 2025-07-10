
-- Create activity_logs table to track user activity
CREATE TABLE public.activity_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  active_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- Add Row Level Security (RLS)
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view their own activity logs
CREATE POLICY "Users can view their own activity logs" 
  ON public.activity_logs 
  FOR SELECT 
  USING (user_id = auth.uid());

-- Create policy for users to insert their own activity logs
CREATE POLICY "Users can insert their own activity logs" 
  ON public.activity_logs 
  FOR INSERT 
  WITH CHECK (user_id = auth.uid());

-- Create policy for users to update their own activity logs
CREATE POLICY "Users can update their own activity logs" 
  ON public.activity_logs 
  FOR UPDATE 
  USING (user_id = auth.uid());

-- Insert some sample data for testing (replace with actual user_id)
INSERT INTO public.activity_logs (user_id, date, active_minutes) VALUES
  -- This week's data (adjust dates to current week)
  ('e31e20b8-fcfc-4541-800e-c14197f3275b', CURRENT_DATE - INTERVAL '6 days', 180), -- Monday: 3h
  ('e31e20b8-fcfc-4541-800e-c14197f3275b', CURRENT_DATE - INTERVAL '5 days', 240), -- Tuesday: 4h
  ('e31e20b8-fcfc-4541-800e-c14197f3275b', CURRENT_DATE - INTERVAL '4 days', 150), -- Wednesday: 2.5h
  ('e31e20b8-fcfc-4541-800e-c14197f3275b', CURRENT_DATE - INTERVAL '3 days', 300), -- Thursday: 5h
  ('e31e20b8-fcfc-4541-800e-c14197f3275b', CURRENT_DATE - INTERVAL '2 days', 210), -- Friday: 3.5h
  ('e31e20b8-fcfc-4541-800e-c14197f3275b', CURRENT_DATE - INTERVAL '1 days', 90),  -- Saturday: 1.5h
  ('e31e20b8-fcfc-4541-800e-c14197f3275b', CURRENT_DATE, 323); -- Today: 5h 23m
