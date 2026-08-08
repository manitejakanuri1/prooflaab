-- Several SECURITY DEFINER functions were EXECUTE-able by anon. Most check the
-- caller internally, but reset_daily_credits does not: it takes no arguments and
-- refills every student's AI credit allowance, so any anonymous caller could
-- remove the spend cap by calling it in a loop. award_pack_completion is worse
-- in kind — it takes a student id and grants XP, with nothing tying that id to
-- the caller.
--
-- Revoked by OID rather than by signature so overloads and argument lists cannot
-- be guessed wrong. service_role holds its own grant and is unaffected, so the
-- scheduled job that calls reset_daily_credits keeps working.
DO $$
DECLARE
  fn record;
  -- never reachable from a browser session
  server_only text[] := ARRAY['reset_daily_credits', 'award_pack_completion'];
  -- privileged, but a logged-in admin legitimately calls them
  admin_only  text[] := ARRAY['create_task_pack', 'update_task_pack', 'delete_task_pack',
                              'assign_pack_to_batch', 'notify_all_admins',
                              'create_user_with_role'];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(server_only || admin_only)
  LOOP
    IF fn.proname = ANY(server_only) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', fn.sig);
      RAISE NOTICE 'revoked anon+authenticated: %', fn.sig;
    ELSE
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn.sig);
      RAISE NOTICE 'revoked anon: %', fn.sig;
    END IF;
  END LOOP;
END $$;;
