-- Rollback of 117: put back the old close_season (most points) and run_all_seasons
-- (closes at the start of the last week). The scoring-rule defaults are kept:
-- without them every college scores 0.
begin;

create or replace function public.close_season(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare podium uuid[]; names text[];
begin
  select array_agg(id order by points desc nulls last, name),
         array_agg(name order by points desc nulls last, name)
    into podium, names
    from public.squads where season_id = _season_id;
  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3]),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3]);
end $function$;

create or replace function public.run_all_seasons()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare s record; done integer := 0; moved integer := 0; closed integer := 0; wk integer;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    wk := public.season_week(s.id);

    if wk > 1 then
      perform public.run_squad_week(s.id, wk - 1);
      done := done + 1;
    end if;

    if (select count(*) from public.squads where season_id = s.id and archived_at is null) >= 2 then
      perform public.advance_season(s.id);
      moved := moved + 1;
    end if;

    if wk >= s.planned_weeks then
      perform public.close_season(s.id);
      closed := closed + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'seasons_scored', done,
                            'seasons_advanced', moved, 'seasons_closed', closed,
                            'ran_at', now());
end $function$;

revoke all on function public.close_season(uuid) from public, anon, authenticated;
revoke all on function public.run_all_seasons() from public, anon, authenticated;
grant execute on function public.close_season(uuid) to service_role;
grant execute on function public.run_all_seasons() to service_role;

commit;
notify pgrst, 'reload schema';
