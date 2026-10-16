-- 117: the season champion is the squad that wins the final.
--
-- Found by the 12-week season simulation on staging (16 Oct 2026, SIM12 College):
--
-- 1. Staging had no platform-default scoring rules (squad_scoring_rules rows with
--    college_id null). Every college without its own rules scored 0 points every
--    week, so every match was a 0-0 draw. The six defaults (stage 16 values) are
--    put back where they are missing. Rows that exist are left exactly as they are.
--
-- 2. close_season() crowned the squad with the most season points, ignoring the
--    final. A squad could lose the final and still be named Season Champion.
--    It now reads the final: winner = champion, loser = runner-up, and third =
--    the better-seeded semi-final loser. A drawn final goes to the better seed,
--    the same tie rule generate_final() uses for drawn semi-finals. Only a season
--    with no played final falls back to season points (as before).
--
-- 3. run_all_seasons() closed the season on the run that STARTS the last week,
--    the same run that creates the final, so the final was never played.
--    It now closes a season only once its last week has ended: it scores that
--    last week (which settles the final) and then closes it.
begin;

-- 1. Platform-default scoring rules, only where missing.
insert into public.squad_scoring_rules (metric, label, points, description, college_id) values
  ('lot_submitted',      'Lot submitted',        10, 'The daily task, done.', null),
  ('proof_verified',     'Proof verified',       25, 'Work that survived checking — the most a student can be worth in a week.', null),
  ('topic_cleared',      'Topic cleared',        12, 'A step of the roadmap finished.', null),
  ('voice_recorded',     'Explanation recorded', 8,  'Saying out loud what you built. Cheap to do, hard to fake.', null),
  ('match_participated', 'Match played',          5, 'Turning up for the squad.', null),
  ('active_day',         'Active day',            3, 'Counted once per day regardless of how much was done, so one busy day cannot carry a whole week.', null)
on conflict (metric, college_id) do nothing;

-- 2. Champion from the final.
create or replace function public.close_season(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  podium uuid[]; names text[];
  fin record; champ uuid; runner uuid; third uuid;
begin
  select * into fin from public.squad_matches
   where season_id = _season_id and stage = 'final' and status = 'played'
   order by scheduled_at desc limit 1;

  if fin.id is not null then
    champ := case
      when coalesce(fin.home_points, 0) > coalesce(fin.away_points, 0) then fin.home_squad
      when coalesce(fin.away_points, 0) > coalesce(fin.home_points, 0) then fin.away_squad
      else (select id from public.squads where id in (fin.home_squad, fin.away_squad)
             order by seed nulls last, points desc limit 1)
    end;
    runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;

    -- Third: the semi-final losers, better seed first.
    select q.id into third
      from public.squad_matches m
      join public.squads q on q.id in (m.home_squad, m.away_squad)
     where m.season_id = _season_id and m.stage = 'knockout' and m.status = 'played'
       and q.id not in (champ, runner)
     order by q.seed nulls last, q.points desc
     limit 1;

    podium := array[champ, runner, third];
  else
    select array_agg(id order by points desc nulls last, name)
      into podium
      from public.squads where season_id = _season_id;
  end if;

  select array_agg(q.name order by p.i) into names
    from unnest(podium) with ordinality p(id, i) join public.squads q on q.id = p.id;

  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', case when fin.id is not null then 'final' else 'points' end),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', case when fin.id is not null then 'final' else 'points' end);
end $function$;

-- 3. Close only after the last week has been played.
create or replace function public.run_all_seasons()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare s record; done integer := 0; moved integer := 0; closed integer := 0; wk integer;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    -- The last week is over: score it (this settles the final), then close.
    if current_date >= s.starts_on + s.planned_weeks * 7 then
      perform public.run_squad_week(s.id, s.planned_weeks);
      done := done + 1;
      perform public.close_season(s.id);
      closed := closed + 1;
      continue;
    end if;

    wk := public.season_week(s.id);

    if wk > 1 then
      perform public.run_squad_week(s.id, wk - 1);
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

revoke all on function public.close_season(uuid) from public, anon, authenticated;
revoke all on function public.run_all_seasons() from public, anon, authenticated;
grant execute on function public.close_season(uuid) to service_role;
grant execute on function public.run_all_seasons() to service_role;

do $$
begin
  if (select count(*) from public.squad_scoring_rules where college_id is null) < 6 then
    raise exception '117 self-check: platform-default scoring rules missing';
  end if;
  if position('stage = ''final''' in pg_get_functiondef('public.close_season(uuid)'::regprocedure)) = 0 then
    raise exception '117 self-check: close_season does not read the final';
  end if;
  if position('planned_weeks * 7' in pg_get_functiondef('public.run_all_seasons()'::regprocedure)) = 0 then
    raise exception '117 self-check: run_all_seasons still closes at the start of the last week';
  end if;
  if has_function_privilege('authenticated', 'public.close_season(uuid)', 'EXECUTE') then
    raise exception '117 self-check: close_season is callable by authenticated';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
