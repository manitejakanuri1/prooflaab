-- Create social_notifications table for social feed notifications
CREATE TABLE public.social_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  triggered_by UUID,
  type TEXT NOT NULL CHECK (type IN ('follow', 'like', 'comment', 'new_post')),
  post_id UUID,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read BOOLEAN NOT NULL DEFAULT false
);

-- Create indexes for performance
CREATE INDEX idx_social_notifications_user_id ON public.social_notifications(user_id);
CREATE INDEX idx_social_notifications_read ON public.social_notifications(read);
CREATE INDEX idx_social_notifications_created_at ON public.social_notifications(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.social_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own notifications
CREATE POLICY "Users can view their own social notifications"
  ON public.social_notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- RLS Policy: Users can update read status of their own notifications
CREATE POLICY "Users can update read status of their own social notifications"
  ON public.social_notifications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Add comment for documentation
COMMENT ON TABLE public.social_notifications IS 'Stores social feed notifications for follows, likes, comments, and new posts';