-- Create user_follows table for the Follow system
CREATE TABLE public.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL,
  following_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  
  -- Prevent self-follow
  CONSTRAINT no_self_follow CHECK (follower_id != following_id),
  
  -- Prevent duplicate follows
  CONSTRAINT unique_follow UNIQUE (follower_id, following_id)
);

-- Create indexes for performance
CREATE INDEX idx_user_follows_follower_id ON public.user_follows(follower_id);
CREATE INDEX idx_user_follows_following_id ON public.user_follows(following_id);

-- Enable RLS
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only follow as themselves
CREATE POLICY "Users can follow as themselves"
ON public.user_follows
FOR INSERT
TO authenticated
WITH CHECK (follower_id = auth.uid());

-- RLS Policy: Users can only unfollow themselves
CREATE POLICY "Users can unfollow themselves"
ON public.user_follows
FOR DELETE
TO authenticated
USING (follower_id = auth.uid());

-- RLS Policy: Public read access to followers/following
CREATE POLICY "Anyone can view follows"
ON public.user_follows
FOR SELECT
TO authenticated
USING (true);