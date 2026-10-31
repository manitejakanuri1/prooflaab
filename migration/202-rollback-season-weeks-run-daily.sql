-- Rollback of 202: run_all_seasons (163) and extend_all_fixtures (159) as they were before.
begin;

CREATE OR REPLACE FUNCTION public.run_all_seasons()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s record; done integer := 0; moved integer := 0; closed integer := 0; wk integer; pw integer;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    -- The last week is over: score it (this settles the final), then close.
    if (case when public.test_fast_season(s.id) then now() >= s.created_at + s.planned_weeks * interval '10 minutes' else current_date >= s.starts_on + s.planned_weeks * 7 end)
    then
      -- 163 (MF-003): any earlier week that was never scored is scored first.
      for pw in 1..(s.planned_weeks - 1) loop
        if not exists (select 1 from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw) then
          perform public.run_squad_week(s.id, pw);
        end if;
      end loop;
      perform public.run_squad_week(s.id, s.planned_weeks);
      done := done + 1;
      perform public.close_season(s.id);
      closed := closed + 1;
      continue;
    end if;
    wk := public.season_week(s.id);
    -- 163 (MF-003): last week is always (re)scored; any earlier week that was never scored is scored too.
    for pw in 1..(wk - 1) loop
      if pw = wk - 1 or not exists (select 1 from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw) then
        perform public.run_squad_week(s.id, pw);
      end if;
    end loop;
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
end $function$;

CREATE OR REPLACE FUNCTION public.extend_all_fixtures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s record; touched integer := 0;
begin
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
  return jsonb_build_object('ok', true, 'seasons_extended', touched, 'ran_at', now());
end $function$;

notify pgrst, 'reload schema';
commit;
