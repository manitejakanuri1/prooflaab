-- Update the notifications type check constraint to include 'proof' and 'review' types
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check 
CHECK (type = ANY (ARRAY['task'::text, 'feedback'::text, 'achievement'::text, 'general'::text, 'proof'::text, 'review'::text]));