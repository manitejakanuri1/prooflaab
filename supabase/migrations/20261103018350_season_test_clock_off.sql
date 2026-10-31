-- 183a (31 Oct 2026): 184 onward read public.test_fast_season(season) to run the TEST website's PRAGATI seasons on a
-- 10-minute week. That helper was only ever made by scripts/dev-tools/staging_test_week_apply.sql, so a database
-- without it (the REAL website) could not take 184. This makes it exist everywhere: where it is missing it answers
-- false for every season (the normal 7-day clock). Where it already exists (TEST) it is left exactly as it is.
-- Rollback: migration/183a-rollback-season-test-clock-off.sql
begin;

do $do$
begin
  if to_regprocedure('public.test_fast_season(uuid)') is null then
    execute $f$create function public.test_fast_season(_season_id uuid) returns boolean language sql stable
      security definer set search_path to 'public', 'pg_temp' as $b$ select false $b$ $f$;
    revoke all on function public.test_fast_season(uuid) from public, anon;
    grant execute on function public.test_fast_season(uuid) to authenticated, service_role;
  end if;
end $do$;

do $$
begin
  if to_regprocedure('public.test_fast_season(uuid)') is null then
    raise exception '183a: test_fast_season(uuid) is still missing';
  end if;
end $$;

commit;
