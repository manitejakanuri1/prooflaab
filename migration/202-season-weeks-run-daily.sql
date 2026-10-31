-- 202 (MF-052, MF-054): season weeks are scored and the next stage is built every morning, not once a week.
--   MF-052: a season starts on any weekday (ensure_season uses current_date) and its weeks roll over at 00:00 UTC
--     (05:30 IST), but run_all_seasons ran only on Sunday 23:30 IST. So a knockout / final / v1 league was built
--     up to 6 days into its own week, dated in the past. Now the daily extend-fixtures job (05:37 IST) also runs
--     run_all_seasons(): the week that just ended is scored and the new week's fixtures exist 7 minutes into it.
--   MF-054: a missed run left a week's matches 'scheduled' for good when the week had scores (e.g. fixtures made
--     after the week was scored). A past week is now (re)scored when it has no scores, still has a 'scheduled'
--     match, or was scored before it ended. A week scored after it ended is not scored again, so running daily
--     is idempotent (no repeat audit rows, previous_rank kept).
-- Rollback: migration/202-rollback-season-weeks-run-daily.sql
begin;

create or replace function public.run_all_seasons()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; done integer := 0; moved integer := 0; closed integer := 0; wk integer; pw integer; closing boolean;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    -- The last week is over: score it (this settles the final), then close.
    closing := (case when public.test_fast_season(s.id) then now() >= s.created_at + s.planned_weeks * interval '10 minutes'
                     else current_date >= s.starts_on + s.planned_weeks * 7 end);
    wk := case when closing then s.planned_weeks + 1 else public.season_week(s.id) end;
    -- 202 (MF-054): every past week that has no scores, still has an unsettled match, or was scored before it ended.
    if exists (select 1 from public.squads where season_id = s.id) then
      for pw in 1..(wk - 1) loop
        if not exists (select 1 from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw)
           or exists (select 1 from public.squad_matches m
                       where m.season_id = s.id and m.round_number = pw and m.status = 'scheduled')
           or (select max(x.computed_at) from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw)
              < (select b.ends_at from public.season_week_bounds(s.id, pw) b)
        then
          perform public.run_squad_week(s.id, pw);
        end if;
      end loop;
    end if;
    if closing then
      done := done + 1;
      perform public.close_season(s.id);
      closed := closed + 1;
      continue;
    end if;
    if wk > 1 then
      done := done + 1;
    end if;
    if (select count(*) from public.squads where season_id = s.id and archived_at is null) >= 2 then
      perform public.advance_season(s.id);
      moved := moved + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'seasons_scored', done,
                            'seasons_advanced', moved, 'seasons_closed', closed,
                            'ran_at', now());
end $fn$;

-- MF-052: the daily job (05:37 IST, just after the season week rolls over at 05:30 IST) runs the season work too.
create or replace function public.extend_all_fixtures()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; touched integer := 0; seasons jsonb;
begin
  begin
    seasons := public.run_all_seasons();
  exception when others then
    raise notice 'run_all_seasons failed: %', sqlerrm;  -- the weekly job still runs it and alerts on failure
    seasons := jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  for s in select id from public.seasons where is_current and status = 'active' loop
    continue when public.season_phase(s.id) is distinct from 'league';
    -- Only for a squad that has never had a league fixture (formed mid-league).
    if exists (
      select 1 from public.squads q
       where q.season_id = s.id and q.archived_at is null
         and not exists (
           select 1 from public.squad_matches m
            where m.season_id = s.id and m.stage = 'league'
              and (m.home_squad = q.id or m.away_squad = q.id))
    ) then
      begin
        perform public.extend_fixtures(s.id);
        touched := touched + 1;
      exception when others then
        raise notice 'extend_fixtures failed for season %: %', s.id, sqlerrm;
      end;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'seasons_extended', touched, 'seasons', seasons, 'ran_at', now());
end $fn$;

revoke all on function public.run_all_seasons() from public, anon, authenticated;
grant execute on function public.run_all_seasons() to service_role;
revoke all on function public.extend_all_fixtures() from public, anon, authenticated;
grant execute on function public.extend_all_fixtures() to service_role;

do $$ begin
  if position('MF-054' in pg_get_functiondef('public.run_all_seasons()'::regprocedure)) = 0 then
    raise exception '202: run_all_seasons not replaced';
  end if;
  if position('run_all_seasons()' in pg_get_functiondef('public.extend_all_fixtures()'::regprocedure)) = 0 then
    raise exception '202: extend_all_fixtures does not run the seasons';
  end if;
  if not has_function_privilege('service_role', 'public.extend_all_fixtures()', 'execute')
     or has_function_privilege('authenticated', 'public.run_all_seasons()', 'execute') then
    raise exception '202: grants wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
