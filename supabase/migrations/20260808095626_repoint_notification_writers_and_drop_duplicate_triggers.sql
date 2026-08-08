-- Part 1: six events were firing two triggers each, so every one of them
-- created two notifications. In each pair one version was also wrong:
--
--   like      keep notify_post_like       drop notify_on_like
--   comment   keep notify_post_comment    drop notify_on_comment
--             (the dropped two wrote proof_posts.student_id -- a
--              student_profiles id -- into a column holding auth user ids, so
--              those notifications were addressed to nobody)
--   follow    keep notify_follow          drop notify_on_follow
--             (the dropped one said "Someone" instead of the follower's name)
--   new post  keep notify_new_post        drop notify_on_new_post
--             (the dropped one compared an auth id to a student id, so it
--              matched no followers, and it fired on private posts)
--   task      keep create_task_assignment_notification_v2
--             drop create_task_assignment_notification (no link in the message)
--   review    keep notify_status_update
--             drop create_proof_review_notification (no rejection reason)

DROP TRIGGER IF EXISTS trigger_notify_on_like     ON public.post_likes;
DROP TRIGGER IF EXISTS trigger_notify_on_comment  ON public.post_comments;
DROP TRIGGER IF EXISTS trigger_notify_on_follow   ON public.user_follows;
DROP TRIGGER IF EXISTS trigger_notify_on_new_post ON public.proof_posts;
DROP TRIGGER IF EXISTS task_assignment_notification_trigger ON public.tasks;
DROP TRIGGER IF EXISTS trigger_proof_review_notification    ON public.proof_uploads;

DROP FUNCTION IF EXISTS public.notify_on_like();
DROP FUNCTION IF EXISTS public.notify_on_comment();
DROP FUNCTION IF EXISTS public.notify_on_follow();
DROP FUNCTION IF EXISTS public.notify_on_new_post();
DROP FUNCTION IF EXISTS public.create_task_assignment_notification();
DROP FUNCTION IF EXISTS public.create_proof_review_notification();

-- Part 2: everything that writes a notification now writes to the one table.
-- The student writers all held a student_profiles id; they resolve it to the
-- auth user id the merged table is keyed on.

CREATE OR REPLACE FUNCTION public.award_pack_completion(p_student_id uuid, p_pack_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  pack_reward_xp INTEGER;
  pack_reward_badge TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.student_pack_completions WHERE student_id = p_student_id AND pack_id = p_pack_id) THEN
    RETURN FALSE;
  END IF;

  SELECT reward_xp, reward_badge INTO pack_reward_xp, pack_reward_badge
  FROM public.task_packs WHERE id = p_pack_id;

  INSERT INTO public.student_pack_completions (student_id, pack_id, xp_awarded, badge_awarded)
  VALUES (p_student_id, p_pack_id, COALESCE(pack_reward_xp, 0), pack_reward_badge);

  IF pack_reward_xp > 0 THEN
    UPDATE public.student_profiles SET total_xp = total_xp + pack_reward_xp WHERE id = p_student_id;
    INSERT INTO public.xp_logs (student_id, xp_points, source)
    VALUES (p_student_id, pack_reward_xp, 'Pack Completion');
  END IF;

  INSERT INTO public.notifications (user_id, audience, type, title, message)
  SELECT sp.user_id, 'student', 'achievement', 'Pack Completed! 🎉',
         'Congratulations! You completed the "' || tp.name || '" pack and earned '
           || COALESCE(pack_reward_xp, 0) || ' XP!'
  FROM public.task_packs tp
  JOIN public.student_profiles sp ON sp.id = p_student_id
  WHERE tp.id = p_pack_id AND sp.user_id IS NOT NULL;

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_announcement_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, audience, type, title, message, link)
  SELECT sp.user_id, 'student', 'announcement', NEW.title,
         LEFT(NEW.description, 150), '/student/announcements/' || NEW.id::text
  FROM public.student_profiles sp
  WHERE sp.status = 'active' AND sp.user_id IS NOT NULL;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_application_status_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('Accepted', 'Rejected') THEN
    INSERT INTO public.notifications (user_id, audience, type, title, message)
    SELECT sp.user_id, 'student', 'application_status',
      CASE WHEN NEW.status = 'Accepted' THEN 'Application Accepted ✅'
           ELSE 'Application Rejected ❌' END,
      CASE WHEN NEW.status = 'Accepted'
           THEN 'Your application for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was accepted!'
           ELSE 'Your application for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was rejected. '
                || COALESCE('Reason: ' || NEW.rejection_reason, '') END
    FROM public.student_profiles sp
    WHERE sp.id = NEW.student_id AND sp.user_id IS NOT NULL;

    IF NEW.status = 'Accepted' THEN
      INSERT INTO public.task_assignments (task_id, student_id, status, assigned_at)
      VALUES (NEW.task_id, NEW.student_id, 'assigned', now())
      ON CONFLICT (task_id, student_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_proof_submission_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, audience, type, title, message)
  SELECT sp.user_id, 'student', 'proof', 'Proof Submitted',
         'You submitted a proof for: "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '"'
  FROM public.student_profiles sp
  WHERE sp.id = NEW.student_id AND sp.user_id IS NOT NULL;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_task_assignment_notification_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  target_user uuid;
BEGIN
  IF NEW.student_id IS NOT NULL AND (OLD.student_id IS NULL OR OLD.student_id != NEW.student_id) THEN
    SELECT user_id INTO target_user FROM public.student_profiles WHERE id = NEW.student_id;
    IF target_user IS NULL THEN
      RETURN NEW;
    END IF;

    -- Same task assigned twice in quick succession should still only tell the
    -- student once.
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = target_user
        AND type = 'task'
        AND message = 'New task assigned: "' || NEW.title || '"'
        AND created_at > now() - interval '5 minutes'
    ) THEN
      INSERT INTO public.notifications (user_id, audience, type, title, message, link)
      VALUES (target_user, 'student', 'task', 'New Task Assigned',
              'New task assigned: "' || NEW.title || '"',
              '/student/tasks/' || NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_task_posted_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.visibility = 'public' AND NEW.approved_by_admin = true AND NEW.student_id IS NULL THEN
    INSERT INTO public.notifications (user_id, audience, type, title, message, link)
    SELECT sp.user_id, 'student', 'task_posted', 'New Task Available',
           'New task posted: "' || NEW.title || '"',
           '/student/tasks/' || NEW.id::text
    FROM public.student_profiles sp
    WHERE sp.status = 'active' AND sp.user_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_xp_reward_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, audience, type, title, message)
  SELECT sp.user_id, 'student', 'achievement', 'XP Reward! 🎉',
         'You earned ' || NEW.xp_points || ' XP points! 🎉'
  FROM public.student_profiles sp
  WHERE sp.id = NEW.student_id AND sp.user_id IS NOT NULL;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_retest_unlocks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  r record;
  weak_count int;
begin
  for r in
    select ra.id, ra.student_id, ra.answer_scores, rc.target_role
    from public.resume_assessments ra
    join public.resume_claims rc on rc.id = ra.resume_claims_id
    where ra.status = 'graded'
      and ra.updated_at <= now() - interval '3 days'
      and (ra.retest_notified_at is null or ra.retest_notified_at < ra.updated_at)
  loop
    select count(*) into weak_count
    from jsonb_array_elements(coalesce(r.answer_scores, '[]'::jsonb)) elem
    where (elem->>'final_score')::numeric < 70;

    if weak_count > 0 then
      insert into public.notifications (user_id, audience, type, title, message, link)
      select sp.user_id, 'student', 'task', 'Retest unlocked',
        'Your 3-day study window is up -- retake the weak-topic retest for ' ||
          coalesce(r.target_role, 'your target role') || ' while it''s fresh.',
        '/student/resume-onboarding'
      from public.student_profiles sp
      where sp.id = r.student_id and sp.user_id is not null;
    end if;

    update public.resume_assessments set retest_notified_at = now() where id = r.id;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_status_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('Verified', 'Rejected') THEN
    INSERT INTO public.notifications (user_id, audience, type, title, message)
    SELECT sp.user_id, 'student', 'review',
      CASE WHEN NEW.status = 'Verified' THEN 'Task Verified ✅' ELSE 'Task Rejected ❌' END,
      CASE WHEN NEW.status = 'Verified'
           THEN 'Your proof for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" has been verified!'
           ELSE 'Your proof for "' || (SELECT title FROM public.tasks WHERE id = NEW.task_id) || '" was rejected. '
                || COALESCE('Reason: ' || NEW.review_comment, '') END
    FROM public.student_profiles sp
    WHERE sp.id = NEW.student_id AND sp.user_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_student_of_recruiter_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_post_title text;
begin
  select title into v_post_title from public.proof_posts where id = NEW.post_id;

  insert into public.notifications (user_id, audience, type, title, message, link, post_id)
  select sp.user_id, 'student', 'recruiter_interest',
         'A recruiter is interested in your work',
         NEW.recruiter_email || ' reached out about "' || coalesce(v_post_title, 'your project') || '".',
         '/student/recruiter-interest', NEW.post_id
  from public.student_profiles sp
  where sp.id = NEW.student_id and sp.user_id is not null;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_application_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, audience, type, title, message)
  SELECT t.created_by_startup_id, 'startup', 'application', 'New Task Application',
         'A student applied for your task: "' || t.title || '"'
  FROM public.tasks t
  WHERE t.id = NEW.task_id AND t.created_by_startup_id IS NOT NULL;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_all_admins(
  notification_type text,
  notification_title text,
  notification_message text,
  notification_link text DEFAULT NULL::text,
  notification_metadata jsonb DEFAULT NULL::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- This runs as the definer, so without this check any caller who was granted
  -- EXECUTE could post a message into every admin's inbox.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin may notify admins';
  END IF;

  INSERT INTO public.notifications (user_id, audience, type, title, message, link, metadata)
  SELECT ur.user_id, 'admin', notification_type, notification_title,
         notification_message, notification_link, notification_metadata
  FROM public.user_roles ur
  WHERE ur.role = 'admin'::app_role;
END;
$function$;

-- The four social writers that survived, now on the merged table.

CREATE OR REPLACE FUNCTION public.notify_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  follower_name TEXT;
BEGIN
  SELECT full_name INTO follower_name
  FROM public.student_profiles WHERE user_id = NEW.follower_id;

  INSERT INTO public.notifications (user_id, audience, source, type, title, message, link, actor_id)
  VALUES (NEW.following_id, 'student', 'social', 'follow', 'New Follower',
          COALESCE(follower_name, 'Someone') || ' started following you',
          '/portfolio/' || NEW.follower_id::text, NEW.follower_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_new_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  post_creator_user_id UUID;
  post_creator_name TEXT;
BEGIN
  IF NEW.visibility = 'public' THEN
    SELECT user_id, full_name INTO post_creator_user_id, post_creator_name
    FROM public.student_profiles WHERE id = NEW.student_id;

    IF post_creator_user_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (user_id, audience, source, type, title, message, link, actor_id, post_id)
    SELECT follower_id, 'student', 'social', 'new_post', 'New Post',
           COALESCE(post_creator_name, 'Someone') || ' shared a new post',
           '/student/feed?post=' || NEW.id::text,
           post_creator_user_id, NEW.id
    FROM public.user_follows
    WHERE following_id = post_creator_user_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_post_like()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  post_owner_user_id UUID;
  liker_name TEXT;
BEGIN
  SELECT sp.user_id INTO post_owner_user_id
  FROM public.proof_posts pp
  JOIN public.student_profiles sp ON pp.student_id = sp.id
  WHERE pp.id = NEW.post_id;

  SELECT full_name INTO liker_name
  FROM public.student_profiles WHERE user_id = NEW.user_id;

  IF post_owner_user_id IS NOT NULL AND NEW.user_id != post_owner_user_id THEN
    INSERT INTO public.notifications (user_id, audience, source, type, title, message, link, actor_id, post_id)
    VALUES (post_owner_user_id, 'student', 'social', 'like', 'Post Liked',
            COALESCE(liker_name, 'Someone') || ' liked your post',
            '/student/feed?post=' || NEW.post_id::text, NEW.user_id, NEW.post_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  post_owner_user_id UUID;
  commenter_name TEXT;
BEGIN
  SELECT sp.user_id INTO post_owner_user_id
  FROM public.proof_posts pp
  JOIN public.student_profiles sp ON pp.student_id = sp.id
  WHERE pp.id = NEW.post_id;

  SELECT full_name INTO commenter_name
  FROM public.student_profiles WHERE user_id = NEW.user_id;

  IF post_owner_user_id IS NOT NULL AND NEW.user_id != post_owner_user_id THEN
    INSERT INTO public.notifications (user_id, audience, source, type, title, message, link, actor_id, post_id)
    VALUES (post_owner_user_id, 'student', 'social', 'comment', 'New Comment',
            COALESCE(commenter_name, 'Someone') || ' commented on your post',
            '/student/feed?post=' || NEW.post_id::text, NEW.user_id, NEW.post_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- The admin verification screen writes notifications addressed to other people.
-- It used to insert straight from the browser, which silently did nothing --
-- there was no INSERT policy. This is the checked way to do it.
CREATE OR REPLACE FUNCTION public.admin_notify_student(
  p_student_id uuid,
  p_type       text,
  p_title      text,
  p_message    text,
  p_link       text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  target_user uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin may notify a student';
  END IF;

  SELECT user_id INTO target_user FROM public.student_profiles WHERE id = p_student_id;
  IF target_user IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.notifications (user_id, audience, type, title, message, link)
  VALUES (target_user, 'student', p_type, p_title, p_message, p_link);
  RETURN true;
END;
$function$;

-- Keep the door shut. CREATE on a brand-new function hands EXECUTE to PUBLIC.
REVOKE ALL ON FUNCTION public.admin_notify_student(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_all_admins(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_notify_student(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_all_admins(text, text, text, text, jsonb) TO authenticated;
