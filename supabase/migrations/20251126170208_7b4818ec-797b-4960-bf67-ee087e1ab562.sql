-- Create like_post RPC function
CREATE OR REPLACE FUNCTION like_post(p_post_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO post_likes (post_id, user_id)
  VALUES (p_post_id, auth.uid())
  ON CONFLICT (user_id, post_id) DO NOTHING;
  
  -- Update likes count
  UPDATE proof_posts
  SET likes_count = (
    SELECT COUNT(*) FROM post_likes WHERE post_id = p_post_id
  )
  WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create unlike_post RPC function
CREATE OR REPLACE FUNCTION unlike_post(p_post_id UUID)
RETURNS VOID AS $$
BEGIN
  DELETE FROM post_likes
  WHERE post_id = p_post_id AND user_id = auth.uid();
  
  -- Update likes count
  UPDATE proof_posts
  SET likes_count = (
    SELECT COUNT(*) FROM post_likes WHERE post_id = p_post_id
  )
  WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add unique constraint to prevent duplicate likes
ALTER TABLE post_likes DROP CONSTRAINT IF EXISTS unique_post_user_like;
ALTER TABLE post_likes ADD CONSTRAINT unique_post_user_like UNIQUE (user_id, post_id);