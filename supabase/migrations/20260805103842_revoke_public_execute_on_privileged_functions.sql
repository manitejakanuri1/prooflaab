-- The earlier revoke was a no-op: Postgres grants EXECUTE to PUBLIC by default,
-- and anon inherits it from there, so revoking from anon alone changes nothing.
-- The grant has to be removed from PUBLIC and then handed back explicitly to the
-- roles that genuinely need it.
DO $$
DECLARE
  fn record;
  server_only text[] := ARRAY['reset_daily_credits', 'award_pack_completion'];
  admin_only  text[] := ARRAY['create_task_pack', 'update_task_pack', 'delete_task_pack',
                              'assign_pack_to_batch', 'notify_all_admins',
                              'create_user_with_role'];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(server_only || admin_only)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    -- edge functions and the scheduled job run as service_role
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);

    -- admin actions are invoked by a logged-in admin from the dashboard; the
    -- functions already check has_role internally, so authenticated is enough
    IF fn.proname = ANY(admin_only) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn.sig);
    END IF;
  END LOOP;
END $$;;
