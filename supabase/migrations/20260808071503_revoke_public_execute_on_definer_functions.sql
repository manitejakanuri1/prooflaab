-- The previous migration revoked EXECUTE from anon and authenticated and
-- appeared to succeed, but changed nothing. Postgres grants EXECUTE on every
-- new function to PUBLIC by default, and the ACL showed it: "=X/postgres".
-- Revoking from a role that never held its own grant is a no-op -- the
-- privilege has to come off PUBLIC.
--
-- Scoped to SECURITY DEFINER functions only. Those are the ones that step
-- around row-level security, and leaving ordinary functions alone avoids
-- breaking column defaults or expressions that quietly depend on PUBLIC.
--
-- service_role and postgres hold their own explicit grants, so edge functions
-- and migrations are unaffected.

DO $$
DECLARE
  fn      RECORD;
  keep    TEXT[] := ARRAY[
    -- row-security helpers: policies cannot be evaluated without these
    'has_role', 'is_admin', 'is_student_owner', 'same_college',
    'get_current_student_id', 'is_email_confirmed',
    -- the remote procedures the client actually calls
    'complete_own_wizard', 'create_proof_post', 'follow_user', 'unfollow_user',
    'is_following', 'get_follower_count', 'get_following_count',
    'get_follow_recommendations', 'like_post', 'unlike_post',
    'get_post_engagement_summary', 'get_leaderboard', 'get_task_packs',
    'get_task_pack_with_tasks', 'set_proof_publicity',
    'verify_invite_code_and_activate'
  ];
  revoked INT := 0;
BEGIN
  FOR fn IN
    SELECT p.oid,
           format('public.%I(%s)', p.proname,
                  pg_get_function_identity_arguments(p.oid)) AS sig,
           p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    revoked := revoked + 1;

    IF fn.proname = ANY (keep) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
      -- anon hits policies too (public posts, public profiles, recruiter
      -- links) and enters its invite code before the session settles.
      IF fn.proname IN ('has_role','is_admin','is_student_owner','same_college',
                        'get_current_student_id','is_email_confirmed',
                        'verify_invite_code_and_activate') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn.sig);
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'revoked PUBLIC execute on % security definer functions', revoked;
END $$;
