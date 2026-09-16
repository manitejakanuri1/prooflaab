-- Every database function a server function calls can be run by service_role.
--
-- The same trap a third time: functions revoked from PUBLIC lose service_role's
-- EXECUTE too, because it came through PUBLIC. Found in the logs on 16 Sep 2026:
-- touch_streak refused (a voice explanation or mock interview never moved the
-- student's streak) and template_key refused (resume coding questions were
-- never cached, so every student waited for a fresh generation).
--
-- Rather than fix the two that happened to be noticed, this grants every
-- function named in an .rpc('...') call under supabase/functions, by name, on
-- every overload, and refuses to commit unless each one is executable.
-- reset_daily_credits is left out: reset-daily-credits calls it, but the
-- function was never created in this database and nothing schedules that job.

begin;

do $$
declare
  names text[] := array[
    'account_id_for_email', 'ensure_and_claim_lot_template', 'log_security_event',
    'record_task_submission', 'record_topic_attempt', 'release_lot_template',
    'save_lot_template', 'similar_written_submission',
    'template_key', 'touch_lot_template', 'touch_streak', 'touch_template',
    -- started by Cloud Scheduler through scheduled-job
    'form_all_colleges', 'extend_all_fixtures', 'assign_todays_lots',
    'run_all_seasons', 'notify_weekly_progress', 'plan_all_weeks'
  ];
  f record;
  n text;
begin
  foreach n in array names loop
    if not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                    where s.nspname = 'public' and p.proname = n) then
      raise exception 'server function % does not exist in the database', n;
    end if;
    for f in
      select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = n
    loop
      execute format('grant execute on function %s to service_role', f.sig);
      if not has_function_privilege('service_role', f.sig, 'EXECUTE') then
        raise exception 'service_role still cannot run %', f.sig;
      end if;
    end loop;
  end loop;
end $$;

commit;
