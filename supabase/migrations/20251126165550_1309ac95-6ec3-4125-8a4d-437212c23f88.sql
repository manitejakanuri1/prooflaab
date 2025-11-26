-- Create function to notify on post like
CREATE OR REPLACE FUNCTION notify_post_like()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify if liker is not the post owner
  IF NEW.user_id != (SELECT student_id FROM proof_posts WHERE id = NEW.post_id) THEN
    INSERT INTO social_notifications (user_id, triggered_by, type, post_id, message)
    VALUES (
      (SELECT student_id FROM proof_posts WHERE id = NEW.post_id),
      NEW.user_id,
      'like',
      NEW.post_id,
      (SELECT full_name FROM student_profiles WHERE id = NEW.user_id) || ' liked your post'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for post likes
CREATE TRIGGER on_post_like
AFTER INSERT ON post_likes
FOR EACH ROW
EXECUTE FUNCTION notify_post_like();

-- Create function to notify on post comment
CREATE OR REPLACE FUNCTION notify_post_comment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify if commenter is not the post owner
  IF NEW.user_id != (SELECT student_id FROM proof_posts WHERE id = NEW.post_id) THEN
    INSERT INTO social_notifications (user_id, triggered_by, type, post_id, message)
    VALUES (
      (SELECT student_id FROM proof_posts WHERE id = NEW.post_id),
      NEW.user_id,
      'comment',
      NEW.post_id,
      (SELECT full_name FROM student_profiles WHERE id = NEW.user_id) || ' commented on your post'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for post comments
CREATE TRIGGER on_post_comment
AFTER INSERT ON post_comments
FOR EACH ROW
EXECUTE FUNCTION notify_post_comment();

-- Create function to notify on follow
CREATE OR REPLACE FUNCTION notify_follow()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO social_notifications (user_id, triggered_by, type, message)
  VALUES (
    NEW.following_id,
    NEW.follower_id,
    'follow',
    (SELECT full_name FROM student_profiles WHERE id = NEW.follower_id) || ' started following you'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for follows
CREATE TRIGGER on_follow
AFTER INSERT ON user_follows
FOR EACH ROW
EXECUTE FUNCTION notify_follow();

-- Create function to notify followers on new post
CREATE OR REPLACE FUNCTION notify_new_post()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify for public posts
  IF NEW.visibility = 'public' THEN
    INSERT INTO social_notifications (user_id, triggered_by, type, post_id, message)
    SELECT 
      follower_id,
      NEW.student_id,
      'new_post',
      NEW.id,
      (SELECT full_name FROM student_profiles WHERE id = NEW.student_id) || ' shared a new post'
    FROM user_follows
    WHERE following_id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new posts
CREATE TRIGGER on_new_post
AFTER INSERT ON proof_posts
FOR EACH ROW
EXECUTE FUNCTION notify_new_post();