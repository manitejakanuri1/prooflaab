-- Deny by default, then hand back exactly what the app calls.
--
-- Every SECURITY DEFINER function runs with the owner's privileges, which means
-- it steps around row-level security by design. 67 of them were callable by
-- anon -- anyone holding the public API key, logged in or not -- and 74 by any
-- signed-in account. That included 34 trigger functions no client should ever
-- call, and create_user_with_role, which assigns roles.
--
-- The list below was derived from every .rpc() call in src/ and
-- supabase/functions/, so it is what the product actually uses, not a guess.
-- Edge functions authenticate as service_role and are unaffected by these
-- grants.
--
-- WARNING: the REVOKE below is a no-op on its own. Postgres grants EXECUTE on
-- every new function to PUBLIC, and revoking from a role that never held its
-- own grant changes nothing. The follow-up migration
-- 20260808071503_revoke_public_execute_on_definer_functions.sql is what
-- actually closes this. Both are kept so the history matches the database.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Row-security helpers. Policies cannot be evaluated without these, and anon
-- hits policies too (public posts, public profiles, recruiter links), so both
-- roles need them. All are read-only and return false/null for a caller with
-- no session.
GRANT EXECUTE ON FUNCTION
  public.has_role(uuid, app_role),
  public.is_admin(),
  public.is_student_owner(uuid, uuid),
  public.same_college(uuid, uuid),
  public.get_current_student_id(),
  public.is_email_confirmed(uuid)
TO anon, authenticated;

-- The 16 remote procedures the client actually calls. Signed-in only.
GRANT EXECUTE ON FUNCTION
  public.complete_own_wizard(),
  public.create_proof_post(uuid, text, text, text, text[], text),
  public.follow_user(uuid),
  public.unfollow_user(uuid),
  public.is_following(uuid),
  public.get_follower_count(uuid),
  public.get_following_count(uuid),
  public.get_follow_recommendations(),
  public.like_post(uuid),
  public.unlike_post(uuid),
  public.get_post_engagement_summary(uuid),
  public.get_leaderboard(integer),
  public.get_task_packs(text),
  public.get_task_pack_with_tasks(uuid),
  public.set_proof_publicity(uuid, boolean)
TO authenticated;

-- Signup enters the invite code before the session is fully established, so
-- this one stays reachable without a login. It validates the code itself.
GRANT EXECUTE ON FUNCTION
  public.verify_invite_code_and_activate(text, uuid, app_role)
TO anon, authenticated;
