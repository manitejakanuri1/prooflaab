-- Add last_active column to colleges table
ALTER TABLE public.colleges 
ADD COLUMN last_active TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add created_by_college_id to tasks table to track tasks assigned by colleges
ALTER TABLE public.tasks 
ADD COLUMN created_by_college_id UUID DEFAULT NULL;

-- Add foreign key constraint for created_by_college_id
ALTER TABLE public.tasks 
ADD CONSTRAINT fk_tasks_created_by_college 
FOREIGN KEY (created_by_college_id) REFERENCES public.colleges(id) ON DELETE SET NULL;

-- Create index for better performance on college tasks queries
CREATE INDEX IF NOT EXISTS idx_tasks_created_by_college_id ON public.tasks(created_by_college_id);

-- Create function to update college last_active when they log in
CREATE OR REPLACE FUNCTION public.update_college_last_active()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.colleges 
  SET last_active = now()
  WHERE user_id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';

-- Create trigger to automatically update last_active on activity
CREATE TRIGGER update_college_last_active_trigger
  AFTER INSERT ON public.activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_college_last_active();