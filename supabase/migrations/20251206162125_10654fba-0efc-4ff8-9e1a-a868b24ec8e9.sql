-- Drop the old source check constraint
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;

-- Add the new source check constraint with 'pack' included
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check 
CHECK (source = ANY (ARRAY['manual'::text, 'ai'::text, 'template'::text, 'personalized'::text, 'pack'::text]));