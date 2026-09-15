-- Lock ten server-only functions to the server, and let the server run them.
--
-- Two problems, found together, fixed together.
--
-- 1. service_role could not run them. stage14 and later stages revoked these
--    from PUBLIC to keep browsers out. service_role's EXECUTE came through PUBLIC,
--    so the revoke took it too - the trap CLAUDE.md already names. On Supabase
--    the six timed jobs did not notice, because pg_cron ran them as the owner.
--    On Google they are started by Cloud Scheduler through the functions
--    service, which is service_role. And security-log, which writes every failed
--    sign-in, has been refused since the move: public.security_events is empty.
--
-- 2. A signed-in browser COULD run some of them. The first version of this file
--    checked, and found authenticated holding EXECUTE on assign_todays_lots on
--    Google - a later create-or-replace had brought PUBLIC's default grant back.
--    Any logged-in student could have handed out Lots for every college. So the
--    revoke is repeated here for all ten, not assumed.
--
-- The check at the end refuses to commit unless both hold for every function.

begin;

revoke all on function public.log_security_event(text, text, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.bump_llm_cache_hit(text) from public, anon, authenticated;
revoke all on function public.prune_rate_limits() from public, anon, authenticated;
revoke all on function public.form_all_colleges() from public, anon, authenticated;
revoke all on function public.extend_all_fixtures() from public, anon, authenticated;
revoke all on function public.assign_todays_lots() from public, anon, authenticated;
revoke all on function public.run_all_seasons() from public, anon, authenticated;
revoke all on function public.notify_weekly_progress() from public, anon, authenticated;
revoke all on function public.plan_all_weeks() from public, anon, authenticated;

grant execute on function public.log_security_event(text, text, text, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.bump_llm_cache_hit(text) to service_role;
grant execute on function public.prune_rate_limits() to service_role;
grant execute on function public.form_all_colleges() to service_role;
grant execute on function public.extend_all_fixtures() to service_role;
grant execute on function public.assign_todays_lots() to service_role;
grant execute on function public.run_all_seasons() to service_role;
grant execute on function public.notify_weekly_progress() to service_role;
grant execute on function public.plan_all_weeks() to service_role;

do $$
declare
  f text;
  fns text[] := array[
    'public.log_security_event(text,text,text,uuid,text,text,text,jsonb)',
    'public.check_rate_limit(text,text,integer,integer)',
    'public.bump_llm_cache_hit(text)',
    'public.prune_rate_limits()',
    'public.form_all_colleges()',
    'public.extend_all_fixtures()',
    'public.assign_todays_lots()',
    'public.run_all_seasons()',
    'public.notify_weekly_progress()',
    'public.plan_all_weeks()'
  ];
begin
  foreach f in array fns loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'service_role still cannot run %', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '% is still reachable from a browser', f;
    end if;
  end loop;
  raise notice 'all ten: server can run them, browsers cannot';
end $$;

commit;
