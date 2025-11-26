-- Drop existing problematic triggers
DROP TRIGGER IF EXISTS on_post_like ON post_likes;
DROP TRIGGER IF EXISTS on_post_comment ON post_comments;
DROP TRIGGER IF EXISTS on_follow ON user_follows;
DROP TRIGGER IF EXISTS on_new_post ON proof_posts;

-- Drop existing functions
DROP FUNCTION IF EXISTS notify_post_like();
DROP FUNCTION IF EXISTS notify_post_comment();
DROP FUNCTION IF EXISTS notify_follow();
DROP FUNCTION IF EXISTS notify_new_post();

-- Create CORRECTED function to notify on post like
CREATE OR REPLACE FUNCTION notify_post_like()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_user_id UUID;
  liker_student_id UUID;
  liker_name TEXT;
BEGIN
  -- Get post owner's user_id from student_profiles
  SELECT sp.user_id INTO post_owner_user_id
  FROM proof_posts pp
  JOIN student_profiles sp ON pp.student_id = sp.id
  WHERE pp.id = NEW.post_id;
  
  -- Get liker's student profile and name
  SELECT id, full_name INTO liker_student_id, liker_name
  FROM student_profiles
  WHERE user_id = NEW.user_id;
  
  -- Only notify if liker is not the post owner
  IF NEW.user_id != post_owner_user_id THEN
    INSERT INTO social_notifications (user_id, triggered_by, type, post_id, message)
    VALUES (
      post_owner_user_id,
      NEW.user_id,
      'like',
      NEW.post_id,
      COALESCE(liker_name, 'Someone') || ' liked your post'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create CORRECTED function to notify on post comment
CREATE OR REPLACE FUNCTION notify_post_comment()
RETURNS TRIGGER AS $$
DECLARE
  post_owner_user_id UUID;
  commenter_student_id UUID;
  commenter_name TEXT;
BEGIN
  -- Get post owner's user_id from student_profiles
  SELECT sp.user_id INTO post_owner_user_id
  FROM proof_posts pp
  JOIN student_profiles sp ON pp.student_id = sp.id
  WHERE pp.id = NEW.post_id;
  
  -- Get commenter's student profile and name
  SELECT id, full_name INTO commenter_student_id, commenter_name
  FROM student_profiles
  WHERE user_id = NEW.user_id;
  
  -- Only notify if commenter is not the post owner
  IF NEW.user_id != post_owner_user_id THEN
    INSERT INTO social_notifications (user_id, triggered_by, type, post_id, message)
    VALUES (
      post_owner_user_id,
      NEW.user_id,
      'comment',
      NEW.post_id,
      COALESCE(commenter_name, 'Someone') || ' commented on your post'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create CORRECTED function to notify on follow
CREATE OR REPLACE FUNCTION notify_follow()
RETURNS TRIGGER AS $$
DECLARE
  follower_name TEXT;
BEGIN
  -- Get follower's name
  SELECT full_name INTO follower_name
  FROM student_profiles
  WHERE user_id = NEW.follower_id;
  
  INSERT INTO social_notifications (user_id, triggered_by, type, message)
  VALUES (
    NEW.following_id,
    NEW.follower_id,
    'follow',
    COALESCE(follower_name, 'Someone') || ' started following you'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create CORRECTED function to notify followers on new post
CREATE OR REPLACE FUNCTION notify_new_post()
RETURNS TRIGGER AS $$
DECLARE
  post_creator_user_id UUID;
  post_creator_name TEXT;
BEGIN
  -- Only notify for public posts
  IF NEW.visibility = 'public' THEN
    -- Get post creator's user_id and name
    SELECT user_id, full_name INTO post_creator_user_id, post_creator_name
    FROM student_profiles
    WHERE id = NEW.student_id;
    
    -- Notify all followers
    INSERT INTO social_notifications (user_id, triggered_by, type, post_id, message)
    SELECT 
      follower_id,
      post_creator_user_id,
      'new_post',
      NEW.id,
      COALESCE(post_creator_name, 'Someone') || ' shared a new post'
    FROM user_follows
    WHERE following_id = post_creator_user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate triggers
CREATE TRIGGER on_post_like
AFTER INSERT ON post_likes
FOR EACH ROW
EXECUTE FUNCTION notify_post_like();

CREATE TRIGGER on_post_comment
AFTER INSERT ON post_comments
FOR EACH ROW
EXECUTE FUNCTION notify_post_comment();

CREATE TRIGGER on_follow
AFTER INSERT ON user_follows
FOR EACH ROW
EXECUTE FUNCTION notify_follow();

CREATE TRIGGER on_new_post
AFTER INSERT ON proof_posts
FOR EACH ROW
EXECUTE FUNCTION notify_new_post();