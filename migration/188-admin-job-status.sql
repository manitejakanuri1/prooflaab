-- 188 (MF-036): admin Jobs & health showed only counters. admin_job_status() lists each scheduled job with its
-- schedule, the next run, and the last run the database can prove (the rows or audit lines the job leaves).
-- Read only. The schedule times are the Cloud Scheduler times (also listed in scheduled-job/index.ts).
-- Rollback: migration/188-rollback-admin-job-status.sql
begin;
create or replace function public.admin_job_status()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare now_ist timestamp := now() at time zone 'Asia/Kolkata';
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return (select jsonb_agg(jsonb_build_object(
            'job', j.job, 'what', j.what, 'schedule', j.schedule,
            'next_run', (case when j.dow is null
                           then date_trunc('day', now_ist) + j.at + case when date_trunc('day', now_ist) + j.at <= now_ist then interval '1 day' else interval '0' end
                           else date_trunc('day', now_ist) + j.at
                                + make_interval(days => ((j.dow - extract(dow from now_ist)::int + 7) % 7))
                                + case when date_trunc('day', now_ist) + j.at
                                            + make_interval(days => ((j.dow - extract(dow from now_ist)::int + 7) % 7)) <= now_ist
                                       then interval '7 days' else interval '0' end
                         end) at time zone 'Asia/Kolkata',
            'last_run', j.last_run,
            'proof', j.proof) order by j.ord)
    from (values
      (1, 'nightly-squads', 'Forms squads, opens the next season after the days off', 'Daily 05:35', time '05:35', null::int,
          (select max(created_at) from public.audit_logs where action = 'SQUADS_FORMED'), 'last "squads formed" audit line'),
      (2, 'extend-fixtures', 'Fixtures for squads that joined mid-league', 'Daily 05:37', time '05:37', null,
          (select max(created_at) from public.audit_logs where action = 'LEAGUE_EXTENDED'), 'leaves a line only when it adds fixtures'),
      (3, 'daily-lots', 'Creates today''s Daily Lot for every student', 'Daily 05:40', time '05:40', null,
          (select max(created_at) from public.tasks where source = 'daily_lot'), 'newest Daily Lot row'),
      (4, 'weekly-seasons', 'Scores the week, settles matches, moves seasons on', 'Sunday 23:30', time '23:30', 0,
          (select max(created_at) from public.audit_logs where action = 'SQUAD_WEEK_SCORED'), 'last "week scored" audit line'),
      (5, 'weekly-progress', 'Weekly progress messages', 'Sunday 23:45', time '23:45', 0, null::timestamptz, 'keeps no trace in the database'),
      (6, 'weekly-plan', 'Plans each student''s week', 'Monday 08:00', time '08:00', 1, null::timestamptz, 'keeps no trace in the database'),
      (7, 'prune-events', 'Deletes step-trail rows older than 90 days', 'Daily 03:10', time '03:10', null,
          null::timestamptz, 'keeps no trace in the database')
    ) as j(ord, job, what, schedule, at, dow, last_run, proof));
end $fn$;
revoke all on function public.admin_job_status() from public, anon;
grant execute on function public.admin_job_status() to authenticated, service_role;
do $$ begin
  if to_regprocedure('public.admin_job_status()') is null then raise exception '188: not created'; end if;
end $$;
notify pgrst, 'reload schema';
commit;
