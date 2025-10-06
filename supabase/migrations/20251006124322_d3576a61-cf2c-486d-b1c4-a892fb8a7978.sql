-- Drop the existing check constraint on notifications.type
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- Add updated check constraint with all valid notification types
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check 
CHECK (type IN ('general', 'task', 'proof', 'review', 'achievement', 'announcement', 'task_posted', 'application_status'));

-- Add comment explaining the notification types
COMMENT ON COLUMN public.notifications.type IS 'Notification type: general, task, proof, review, achievement, announcement, task_posted, application_status';