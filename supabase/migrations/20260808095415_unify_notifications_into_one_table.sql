-- Four notification tables became one.
--
-- notifications (students), admin_notifications, social_notifications and
-- startup_notifications held the same idea four times, with four different
-- names for the owner column (student_id / admin_user_id / user_id /
-- startup_user_id) and two different names for "read" (is_read / read). Every
-- screen that wanted to show a bell had to query several of them, merge the
-- shapes in JavaScript, and branch on source to mark one as read.
--
-- The merged table is keyed on user_id -- always an auth user id -- with
-- `audience` for who it is addressed to and `source` for whether a person or
-- the system caused it.
--
-- Two real bugs get fixed on the way through:
--
--   * The admin policies said "their own notifications" but only checked that
--     the caller was an admin. Any admin could read and delete every other
--     admin's notifications. The new policies compare the owner.
--   * None of the four had an INSERT policy, so the two inserts the admin
--     verification screen makes have been failing silently. They now go
--     through a checked function instead of the client writing rows addressed
--     to other people.

CREATE TABLE public.notifications_unified (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Always an auth user id. The old student table keyed on student_profiles.id,
  -- which is why a notification could never be joined against a social one.
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which dashboard shows it.
  audience   text NOT NULL DEFAULT 'student'
             CHECK (audience IN ('student', 'admin', 'startup', 'college')),

  -- Whether another person caused it (follow, like, comment) or the system did.
  source     text NOT NULL DEFAULT 'system'
             CHECK (source IN ('system', 'social')),

  type       text NOT NULL DEFAULT 'general',
  title      text NOT NULL DEFAULT 'Notification',
  message    text NOT NULL,
  link       text,

  -- Social only: who did it, and what they did it to.
  actor_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id    uuid REFERENCES public.proof_posts(id) ON DELETE CASCADE,

  metadata   jsonb,

  is_read    boolean NOT NULL DEFAULT false,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Carry the existing rows over. Rows whose owner no longer has an auth account
-- are dropped: they are addressed to nobody and the foreign key would reject
-- them anyway.
INSERT INTO public.notifications_unified
  (id, user_id, audience, source, type, title, message, link, is_read, read_at, created_at)
SELECT n.id, sp.user_id, 'student', 'system',
       COALESCE(n.type, 'general'), n.title, n.message, n.link,
       COALESCE(n.is_read, false), n.read_at, COALESCE(n.created_at, now())
FROM public.notifications n
JOIN public.student_profiles sp ON sp.id = n.student_id
JOIN auth.users u ON u.id = sp.user_id;

INSERT INTO public.notifications_unified
  (id, user_id, audience, source, type, title, message, link, metadata, is_read, created_at)
SELECT a.id, a.admin_user_id, 'admin', 'system',
       a.type, a.title, a.message, a.link, a.metadata,
       COALESCE(a.is_read, false), COALESCE(a.created_at, now())
FROM public.admin_notifications a
JOIN auth.users u ON u.id = a.admin_user_id;

INSERT INTO public.notifications_unified
  (id, user_id, audience, source, type, title, message, actor_id, post_id, is_read, created_at)
SELECT s.id, s.user_id, 'student', 'social', s.type,
       CASE s.type
         WHEN 'follow'   THEN 'New Follower'
         WHEN 'like'     THEN 'Post Liked'
         WHEN 'comment'  THEN 'New Comment'
         WHEN 'new_post' THEN 'New Post'
         ELSE 'Notification'
       END,
       s.message, s.triggered_by, s.post_id, s.read, s.created_at
FROM public.social_notifications s
JOIN auth.users u ON u.id = s.user_id;

INSERT INTO public.notifications_unified
  (id, user_id, audience, source, type, title, message, is_read, created_at)
SELECT st.id, st.startup_user_id, 'startup', 'system',
       COALESCE(st.type, 'general'), st.title, st.message,
       COALESCE(st.is_read, false), COALESCE(st.created_at, now())
FROM public.startup_notifications st
JOIN auth.users u ON u.id = st.startup_user_id;

DROP TABLE public.notifications         CASCADE;
DROP TABLE public.admin_notifications   CASCADE;
DROP TABLE public.social_notifications  CASCADE;
DROP TABLE public.startup_notifications CASCADE;

ALTER TABLE public.notifications_unified RENAME TO notifications;

-- The bell only ever asks one question: what has this person not read yet?
CREATE INDEX idx_notifications_inbox
  ON public.notifications (user_id, is_read, created_at DESC);

-- Admin and startup dashboards filter by audience first.
CREATE INDEX idx_notifications_audience
  ON public.notifications (audience, created_at DESC);

-- Both foreign keys need their own index or a deleted post or account has to
-- scan the whole table to find what to clean up.
CREATE INDEX idx_notifications_actor ON public.notifications (actor_id);
CREATE INDEX idx_notifications_post  ON public.notifications (post_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read your own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Mark your own notifications read"
  ON public.notifications FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Delete your own notifications"
  ON public.notifications FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- Deliberately no INSERT policy. Every notification is written by a trigger or
-- a checked function running as the definer. A browser cannot address a
-- notification to somebody else.

GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;

-- The bell updates live, so the table has to be published for realtime.
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
