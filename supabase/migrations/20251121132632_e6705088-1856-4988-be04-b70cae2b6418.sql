-- Enable realtime for feed tables
-- This allows the frontend to subscribe to insert, update, delete events in real-time
-- RLS policies are still enforced on realtime subscriptions

-- 1) Enable realtime for proof_posts table
alter publication supabase_realtime add table public.proof_posts;

-- 2) Enable realtime for post_likes table
alter publication supabase_realtime add table public.post_likes;

-- 3) Enable realtime for post_comments table
alter publication supabase_realtime add table public.post_comments;