-- ============================================================================
-- Stage 53 — one call that says where the season is.
--
-- Every squad screen needs the same four facts before it can render a single
-- row: which week it is, which phase that week belongs to, how long the season
-- is, and whether qualification has happened yet. Without this each screen
-- would fetch the season, call season_week, call season_phase and count the
-- qualified squads separately - four round trips for a header.
--
-- Safe for any signed-in member of the college: it exposes nothing a squad
-- table does not already show.
-- ============================================================================

create or replace function public.my_season_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare sid uuid := public.my_season_id(); s record; wk integer;
begin
  if sid is null then return jsonb_build_object('season', null); end if;

  select * into s from public.seasons where id = sid;
  wk := public.season_week(sid);

  return jsonb_build_object(
    'season_id',        sid,
    'name',             s.name,
    'status',           s.status,
    'starts_on',        s.starts_on,
    'planned_weeks',    s.planned_weeks,
    'week',             wk,
    'phase',            public.season_phase(sid, wk),
    'label',            (select label from public.season_plan(sid) where week = wk),
    'league_last_week', public.season_league_last_week(sid),
    'plan',             (select jsonb_agg(jsonb_build_object('week', week, 'phase', phase, 'label', label)
                                          order by week) from public.season_plan(sid)),
    'squads',           (select count(*) from public.squads
                          where season_id = sid and archived_at is null),
    'cohorts',          (select count(distinct coalesce(cohort, 'GENERAL')) from public.squads
                          where season_id = sid and archived_at is null),
    'qualified',        (select count(*) from public.squads
                          where season_id = sid and qualified),
    'decided',          exists (select 1 from public.squads
                                 where season_id = sid and qualified is not null)
  );
end $function$;

revoke all on function public.my_season_status() from public, anon, authenticated;
grant execute on function public.my_season_status() to authenticated, service_role;
