-- Third time this bites, so this migration sweeps rather than lists.
--
-- A REVOKE ... FROM PUBLIC does not remove a grant held by a role in its own
-- right, and this project has default privileges that hand EXECUTE on every
-- new function in `public` to anon, authenticated and service_role. So the
-- functions added in the last two migrations came out callable by anyone
-- holding the publishable key, despite the REVOKE at the end of each one.
--
-- The sweep below re-applies the intended allow-list across every SECURITY
-- DEFINER function, taking the privilege off PUBLIC *and* off anon and
-- authenticated first, then granting it back only where the app needs it.
-- Running it again after adding a function is the fix for next time.

DO $$
DECLARE
  fn RECORD;

  -- Callable without signing in: the row-security helpers that policies need
  -- in order to be evaluated at all, signup's invite check, and the public
  -- contact card on a shared proof post.
  anon_ok TEXT[] := ARRAY[
    'has_role', 'is_admin', 'is_student_owner', 'same_college',
    'get_current_student_id', 'is_email_confirmed',
    'verify_invite_code_and_activate', 'get_public_contact'
  ];

  -- Callable once signed in: everything above, plus the remote procedures the
  -- client actually calls.
  auth_ok TEXT[] := ARRAY[
    'has_role', 'is_admin', 'is_student_owner', 'same_college',
    'get_current_student_id', 'is_email_confirmed',
    'verify_invite_code_and_activate', 'get_public_contact',
    'complete_own_wizard', 'create_proof_post', 'follow_user', 'unfollow_user',
    'is_following', 'get_follower_count', 'get_following_count',
    'get_follow_recommendations', 'like_post', 'unlike_post',
    'get_post_engagement_summary', 'get_leaderboard', 'get_task_packs',
    'get_task_pack_with_tasks', 'set_proof_publicity',
    'admin_notify_student', 'notify_all_admins'
  ];
BEGIN
  FOR fn IN
    SELECT format('public.%I(%s)', p.proname,
                  pg_get_function_identity_arguments(p.oid)) AS sig,
           p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);

    IF fn.proname = ANY (auth_ok) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    END IF;

    IF fn.proname = ANY (anon_ok) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn.sig);
    END IF;
  END LOOP;
END $$;

-- And stop the leak at the source, so a function added tomorrow is closed by
-- default instead of open by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
