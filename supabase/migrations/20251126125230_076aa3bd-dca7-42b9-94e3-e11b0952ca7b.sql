-- Drop existing functions that may have conflicting signatures
DROP FUNCTION IF EXISTS public.is_following(uuid);
DROP FUNCTION IF EXISTS public.get_follower_count(uuid);
DROP FUNCTION IF EXISTS public.get_following_count(uuid);

-- RPC: Follow a user
CREATE OR REPLACE FUNCTION public.follow_user(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  INSERT INTO public.user_follows (follower_id, following_id)
  VALUES (auth.uid(), target_id)
  ON CONFLICT DO NOTHING;
END;
$$;

-- RPC: Unfollow a user
CREATE OR REPLACE FUNCTION public.unfollow_user(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_follows
  WHERE follower_id = auth.uid()
    AND following_id = target_id;
END;
$$;

-- RPC: Check if current user is following target user
CREATE OR REPLACE FUNCTION public.is_following(target_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.user_follows
    WHERE follower_id = auth.uid()
      AND following_id = target_id
  );
$$;

-- RPC: Get follower count for a user
CREATE OR REPLACE FUNCTION public.get_follower_count(user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.user_follows
  WHERE following_id = user_id;
$$;

-- RPC: Get following count for a user
CREATE OR REPLACE FUNCTION public.get_following_count(user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.user_follows
  WHERE follower_id = user_id;
$$;