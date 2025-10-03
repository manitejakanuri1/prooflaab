-- Drop the existing constraint
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;

-- Add the updated constraint that includes 'template'
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check 
CHECK (source = ANY (ARRAY['manual'::text, 'ai'::text, 'template'::text, 'personalized'::text]));