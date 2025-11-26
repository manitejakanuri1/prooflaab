-- =====================================================
-- 1️⃣ NOTIFICATION: Someone followed you
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insert notification for the user being followed
  INSERT INTO public.social_notifications (user_id, triggered_by, type, message)
  VALUES (
    NEW.following_id,
    NEW.follower_id,
    'follow',
    'Someone started following you'
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_on_follow
  AFTER INSERT ON public.user_follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_follow();

-- =====================================================
-- 2️⃣ NOTIFICATION: Someone liked your post
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insert notification for post owner (only if liker is not the owner)
  INSERT INTO public.social_notifications (user_id, triggered_by, type, post_id, message)
  SELECT 
    p.student_id,
    NEW.user_id,
    'like',
    NEW.post_id,
    'Someone liked your post'
  FROM public.proof_posts p
  WHERE p.id = NEW.post_id
    AND p.student_id != NEW.user_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_on_like
  AFTER INSERT ON public.post_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_like();

-- =====================================================
-- 3️⃣ NOTIFICATION: Someone commented on your post
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insert notification for post owner (only if commenter is not the owner)
  INSERT INTO public.social_notifications (user_id, triggered_by, type, post_id, message)
  SELECT
    p.student_id,
    NEW.user_id,
    'comment',
    NEW.post_id,
    'Someone commented on your post'
  FROM public.proof_posts p
  WHERE p.id = NEW.post_id
    AND p.student_id != NEW.user_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_on_comment
  AFTER INSERT ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_comment();

-- =====================================================
-- 4️⃣ NOTIFICATION: Someone you follow posted
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_on_new_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insert notifications for all followers of the post creator
  INSERT INTO public.social_notifications (user_id, triggered_by, type, post_id, message)
  SELECT
    f.follower_id,
    NEW.student_id,
    'new_post',
    NEW.id,
    'Someone you follow posted a new project'
  FROM public.user_follows f
  WHERE f.following_id = NEW.student_id
    AND f.follower_id != NEW.student_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_on_new_post
  AFTER INSERT ON public.proof_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_post();