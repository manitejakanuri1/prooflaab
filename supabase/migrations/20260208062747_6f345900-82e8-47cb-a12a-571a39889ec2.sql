-- =====================================================
-- SECURITY HARDENING MIGRATION - Part 2
-- Fix remaining 6 functions and 2 RLS policies
-- =====================================================

-- =====================================================
-- PART 1: Fix remaining function search_paths
-- =====================================================

-- 1. like_post
CREATE OR REPLACE FUNCTION public.like_post(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
BEGIN
  INSERT INTO public.post_likes (post_id, user_id)
  VALUES (p_post_id, auth.uid())
  ON CONFLICT (user_id, post_id) DO NOTHING;
  
  -- Update likes count
  UPDATE public.proof_posts
  SET likes_count = (
    SELECT COUNT(*) FROM public.post_likes WHERE post_id = p_post_id
  )
  WHERE id = p_post_id;
END;
$function$;

-- 2. unlike_post
CREATE OR REPLACE FUNCTION public.unlike_post(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
BEGIN
  DELETE FROM public.post_likes
  WHERE post_id = p_post_id AND user_id = auth.uid();
  
  -- Update likes count
  UPDATE public.proof_posts
  SET likes_count = (
    SELECT COUNT(*) FROM public.post_likes WHERE post_id = p_post_id
  )
  WHERE id = p_post_id;
END;
$function$;

-- 3. notify_follow
CREATE OR REPLACE FUNCTION public.notify_follow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
  follower_name TEXT;
BEGIN
  -- Get follower's name
  SELECT full_name INTO follower_name
  FROM public.student_profiles
  WHERE user_id = NEW.follower_id;
  
  INSERT INTO public.social_notifications (user_id, triggered_by, type, message)
  VALUES (
    NEW.following_id,
    NEW.follower_id,
    'follow',
    COALESCE(follower_name, 'Someone') || ' started following you'
  );
  
  RETURN NEW;
END;
$function$;

-- 4. notify_new_post
CREATE OR REPLACE FUNCTION public.notify_new_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
  post_creator_user_id UUID;
  post_creator_name TEXT;
BEGIN
  -- Only notify for public posts
  IF NEW.visibility = 'public' THEN
    -- Get post creator's user_id and name
    SELECT user_id, full_name INTO post_creator_user_id, post_creator_name
    FROM public.student_profiles
    WHERE id = NEW.student_id;
    
    -- Notify all followers
    INSERT INTO public.social_notifications (user_id, triggered_by, type, post_id, message)
    SELECT 
      follower_id,
      post_creator_user_id,
      'new_post',
      NEW.id,
      COALESCE(post_creator_name, 'Someone') || ' shared a new post'
    FROM public.user_follows
    WHERE following_id = post_creator_user_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- 5. notify_post_comment
CREATE OR REPLACE FUNCTION public.notify_post_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
  post_owner_user_id UUID;
  commenter_student_id UUID;
  commenter_name TEXT;
BEGIN
  -- Get post owner's user_id from student_profiles
  SELECT sp.user_id INTO post_owner_user_id
  FROM public.proof_posts pp
  JOIN public.student_profiles sp ON pp.student_id = sp.id
  WHERE pp.id = NEW.post_id;
  
  -- Get commenter's student profile and name
  SELECT id, full_name INTO commenter_student_id, commenter_name
  FROM public.student_profiles
  WHERE user_id = NEW.user_id;
  
  -- Only notify if commenter is not the post owner
  IF NEW.user_id != post_owner_user_id THEN
    INSERT INTO public.social_notifications (user_id, triggered_by, type, post_id, message)
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
$function$;

-- 6. notify_post_like
CREATE OR REPLACE FUNCTION public.notify_post_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
  post_owner_user_id UUID;
  liker_student_id UUID;
  liker_name TEXT;
BEGIN
  -- Get post owner's user_id from student_profiles
  SELECT sp.user_id INTO post_owner_user_id
  FROM public.proof_posts pp
  JOIN public.student_profiles sp ON pp.student_id = sp.id
  WHERE pp.id = NEW.post_id;
  
  -- Get liker's student profile and name
  SELECT id, full_name INTO liker_student_id, liker_name
  FROM public.student_profiles
  WHERE user_id = NEW.user_id;
  
  -- Only notify if liker is not the post owner
  IF NEW.user_id != post_owner_user_id THEN
    INSERT INTO public.social_notifications (user_id, triggered_by, type, post_id, message)
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
$function$;

-- =====================================================
-- PART 2: Fix remaining permissive RLS policies
-- =====================================================

-- 2.1 Fix recruiter_interests - require proper email validation
DROP POLICY IF EXISTS "Anyone can submit recruiter interest" ON public.recruiter_interests;

CREATE POLICY "Users can submit recruiter interest with valid email"
ON public.recruiter_interests
FOR INSERT
TO anon, authenticated
WITH CHECK (
  -- Validate the recruiter_email is present and looks like an email
  recruiter_email IS NOT NULL 
  AND length(recruiter_email) >= 5
  AND recruiter_email LIKE '%@%.%'
  -- Post must exist and be public
  AND EXISTS (
    SELECT 1 FROM public.proof_posts pp
    WHERE pp.id = post_id
    AND pp.visibility = 'public'
  )
);

-- 2.2 Fix recruiter_link_views - require valid link
DROP POLICY IF EXISTS "Anyone can insert views" ON public.recruiter_link_views;

CREATE POLICY "Users can insert views for valid active links"
ON public.recruiter_link_views
FOR INSERT
TO anon, authenticated
WITH CHECK (
  -- Link must exist, be active, and not expired
  EXISTS (
    SELECT 1 FROM public.recruiter_links rl
    WHERE rl.id = link_id
    AND rl.status = 'active'
    AND rl.expires_at > now()
  )
);