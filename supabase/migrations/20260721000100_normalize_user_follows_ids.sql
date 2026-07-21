-- Normalise public.user_follows to a single id namespace: auth.users.id.
--
-- ============================ THE PROBLEM ============================
-- user_follows stored TWO different id namespaces in its two columns:
--
--   follower_id  = auth.uid()           -- written by follow_user()
--   following_id = student_profiles.id  -- the UI passed targetUserId=student_id
--
-- Every *database* object, however, was written expecting BOTH columns to be
-- auth user ids:
--
--   * notify_follow()  inserts social_notifications.user_id := NEW.following_id
--     -> social_notifications.user_id is an auth uid, so follow notifications
--        were addressed to a profile id and NOBODY EVER RECEIVED THEM.
--   * notify_new_post() selects  WHERE following_id = <author's user_id>
--     -> never matched, so followers never got "new post" notifications.
--   * get_follow_recommendations() joins following_id = sp.user_id and excludes
--     already-followed via sp.user_id NOT IN (following_id ...)
--     -> never matched, so it kept recommending people you already follow.
--   * get_follower_count(uid) counts WHERE following_id = uid (an auth uid)
--     -> never matched, so follower counts read 0 for everyone.
--   * The no_self_follow CHECK compared values from two different namespaces,
--     so it could never fire and self-follows were possible.
--
-- The frontend was the sole violator. This migration converts the stored data
-- to the convention the whole database already assumes, and makes the RPCs
-- tolerant of being handed either id type so the UI cannot reintroduce the bug.
--
-- ============================ SAFETY ============================
-- Back up user_follows before running this. The conversion is not reversible
-- without that backup:
--   CREATE TABLE user_follows_backup_20260721 AS SELECT * FROM public.user_follows;

BEGIN;

-- Keep a snapshot in-database as well, so this is recoverable even if the
-- operator forgot the manual backup above.
--
-- NOTE: a bare table in the `public` schema is exposed through PostgREST, so
-- if you re-run this against a database where user_follows is NOT empty,
-- either enable RLS on the snapshot or drop it once you've verified the
-- migration. On the original run the table was empty and the snapshot was
-- dropped immediately (migration drop_empty_user_follows_backup).
CREATE TABLE IF NOT EXISTS public.user_follows_backup_20260721 AS
SELECT * FROM public.user_follows;
ALTER TABLE public.user_follows_backup_20260721 ENABLE ROW LEVEL SECURITY;

-- Constraints are validated during UPDATE, and the conversion can legitimately
-- produce duplicates / self-follows that must be cleaned up afterwards. Drop
-- them for the duration of the rewrite and re-add at the end.
ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS no_self_follow;
ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS unique_follow;

-- 1. Drop rows whose following_id is a profile id that has no auth user behind
--    it (bulk-CSV students who never claimed an account). These follows cannot
--    be represented in the auth-uid namespace and were already non-functional.
DELETE FROM public.user_follows uf
WHERE EXISTS (
        SELECT 1 FROM public.student_profiles sp
        WHERE sp.id = uf.following_id
          AND sp.user_id IS NULL
      );

-- 2. Convert following_id from student_profiles.id -> student_profiles.user_id.
--    Only rows that actually look like a profile id are touched, so this
--    migration is safe to re-run and safe if some rows were already correct.
UPDATE public.user_follows uf
SET following_id = sp.user_id
FROM public.student_profiles sp
WHERE sp.id = uf.following_id
  AND sp.user_id IS NOT NULL
  -- don't touch a row that is already a valid auth-uid reference
  AND NOT EXISTS (
        SELECT 1 FROM public.student_profiles sp2
        WHERE sp2.user_id = uf.following_id
      );

-- 3. Drop any row that is now a self-follow (someone followed their own profile).
DELETE FROM public.user_follows
WHERE follower_id = following_id;

-- 4. De-duplicate: the conversion can collapse two rows onto the same pair if a
--    user somehow had more than one student_profile. Keep the earliest.
DELETE FROM public.user_follows a
USING public.user_follows b
WHERE a.follower_id = b.follower_id
  AND a.following_id = b.following_id
  AND a.ctid > b.ctid;

-- 5. Drop rows that still don't resolve to a real auth user in either column.
DELETE FROM public.user_follows uf
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = uf.follower_id)
   OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = uf.following_id);

-- Re-establish the invariants, now that both columns share one namespace.
ALTER TABLE public.user_follows
  ADD CONSTRAINT no_self_follow CHECK (follower_id != following_id);
ALTER TABLE public.user_follows
  ADD CONSTRAINT unique_follow UNIQUE (follower_id, following_id);

-- ============================ RPC HARDENING ============================
-- Accept either an auth uid or a student_profiles.id and always store the auth
-- uid. This makes the boundary defensive: existing UI call sites that still
-- pass a profile id keep working and can no longer corrupt the table.

CREATE OR REPLACE FUNCTION public.resolve_follow_target(target_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- already an auth uid belonging to a student
    (SELECT sp.user_id FROM public.student_profiles sp
      WHERE sp.user_id = target_id LIMIT 1),
    -- or a student_profiles.id we can translate
    (SELECT sp.user_id FROM public.student_profiles sp
      WHERE sp.id = target_id LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.follow_user(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved uuid;
BEGIN
  resolved := public.resolve_follow_target(target_id);

  IF resolved IS NULL THEN
    RAISE EXCEPTION 'Cannot follow: no account found for %', target_id;
  END IF;

  IF resolved = auth.uid() THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  INSERT INTO public.user_follows (follower_id, following_id)
  VALUES (auth.uid(), resolved)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.unfollow_user(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved uuid;
BEGIN
  resolved := public.resolve_follow_target(target_id);

  DELETE FROM public.user_follows
  WHERE follower_id = auth.uid()
    AND following_id = COALESCE(resolved, target_id);
END;
$$;

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
      AND following_id = COALESCE(public.resolve_follow_target(target_id), target_id)
  );
$$;

-- Counts are also called with a profile id from some UI paths; normalise here
-- too rather than chasing every call site.
CREATE OR REPLACE FUNCTION public.get_follower_count(user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.user_follows
  WHERE following_id = COALESCE(public.resolve_follow_target(user_id), user_id);
$$;

CREATE OR REPLACE FUNCTION public.get_following_count(user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.user_follows
  WHERE follower_id = COALESCE(public.resolve_follow_target(user_id), user_id);
$$;

GRANT EXECUTE ON FUNCTION public.resolve_follow_target(uuid) TO authenticated;

COMMIT;

-- After verifying the app behaves correctly, drop the snapshot:
--   DROP TABLE public.user_follows_backup_20260721;
