-- Rollback of 203: close_season (184) and my_season_status (184) as they were before. season_champions.decided_by values written meanwhile are left in place (harmless).
begin;

CREATE OR REPLACE FUNCTION public.close_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  podium uuid[]; names text[]; how text; v integer; b record; brackets integer := 0;
  fin record; champ uuid; runner uuid; third uuid;
begin
  select plan_version into v from public.seasons where id = _season_id;
  if v = 2 then
    -- 184: a champion in every bracket that played its final and had a league
    delete from public.season_champions where season_id = _season_id;
    for b in select distinct bracket from public.squads where season_id = _season_id and bracket is not null loop
      select * into fin from public.squad_matches
       where season_id = _season_id and stage = 'final' and cohort = b.bracket and status in ('played', 'no_activity')
       order by scheduled_at desc limit 1;
      continue when fin.id is null;
      continue when not exists (
        select 1 from public.squad_matches m join public.squads q on q.id in (m.home_squad, m.away_squad)
         where m.season_id = _season_id and m.stage = 'league' and m.status = 'played' and q.bracket = b.bracket);
      champ := public.match_winner(fin.id);
      runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;
      third := null;
      select q.id into third
        from public.squad_matches m
        join public.squads q on q.id in (m.home_squad, m.away_squad)
       where m.season_id = _season_id and m.stage = 'knockout' and m.cohort = b.bracket
         and m.status in ('played', 'no_activity') and q.id not in (champ, runner)
       order by q.seed nulls last limit 1;
      insert into public.season_champions (season_id, bracket, champion_squad_id, runner_up_squad_id, third_squad_id)
      values (_season_id, b.bracket, champ, runner, third);
      brackets := brackets + 1;
    end loop;
    if brackets = 1 then
      select array[champion_squad_id, runner_up_squad_id, third_squad_id] into podium
        from public.season_champions where season_id = _season_id;
    end if;
    how := case when brackets > 0 then 'final' else 'no_league' end;
  else
    select * into fin from public.squad_matches
     where season_id = _season_id and stage = 'final' and status in ('played', 'no_activity')
     order by scheduled_at desc limit 1;
    if fin.id is not null then
      champ := coalesce(fin.winner_squad, case
        when coalesce(fin.home_points, 0) > coalesce(fin.away_points, 0) then fin.home_squad
        when coalesce(fin.away_points, 0) > coalesce(fin.home_points, 0) then fin.away_squad
        else (select id from public.squads where id in (fin.home_squad, fin.away_squad)
               order by seed nulls last, points desc limit 1)
      end);
      runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;
      select q.id into third
        from public.squad_matches m
        join public.squads q on q.id in (m.home_squad, m.away_squad)
       where m.season_id = _season_id and m.stage = 'knockout' and m.status in ('played', 'no_activity')
         and q.id not in (champ, runner)
       order by q.seed nulls last, q.points desc
       limit 1;
      podium := array[champ, runner, third];
      how := 'final';
    elsif exists (select 1 from public.squad_matches
                   where season_id = _season_id and stage = 'league' and status = 'played') then
      select array_agg(id order by points desc nulls last, name)
        into podium
        from public.squads where season_id = _season_id;
      how := 'points';
    else
      podium := null;
      how := 'no_league';
    end if;
  end if;
  select array_agg(q.name order by p.i) into names
    from unnest(podium) with ordinality p(id, i) join public.squads q on q.id = p.id;
  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  update public.squad_members m set left_at = now()
    from public.squads q
   where q.id = m.squad_id and q.season_id = _season_id and m.left_at is null;
  update public.squads set archived_at = now()
   where season_id = _season_id and archived_at is null;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', how, 'brackets', brackets),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', how, 'brackets', brackets,
                            'champions', (select coalesce(jsonb_agg(jsonb_build_object(
                                            'bracket', c.bracket, 'champion', q.name) order by c.bracket), '[]'::jsonb)
                                            from public.season_champions c join public.squads q on q.id = c.champion_squad_id
                                           where c.season_id = _season_id));
end $function$;

CREATE OR REPLACE FUNCTION public.my_season_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid := public.my_season_id(); s record; wk integer; last record; nxt timestamptz; yg integer := public.my_year_group();
begin
  if sid is null then
    select x.* into last from public.seasons x where x.id = public.my_last_season_id();
    if last.id is null or last.status is distinct from 'complete' then
      return jsonb_build_object('season', null, 'state', 'none', 'year_group', yg,
                                'year_group_label', coalesce(public.year_group_label(nullif(yg, 0)), 'No year set'));
    end if;
    -- 184: the next season opens after the days off, at the next morning squad job (05:35 IST)
    nxt := last.completed_at + public.season_gap(last.id);
    if not public.test_fast_season(last.id) then
      nxt := (date_trunc('day', nxt at time zone 'Asia/Kolkata') + interval '5 hours 35 minutes') at time zone 'Asia/Kolkata';
      if nxt < last.completed_at + public.season_gap(last.id) then nxt := nxt + interval '1 day'; end if;
    end if;
    return jsonb_build_object(
      'season', null,
      'state', 'complete',
      'year_group', yg,
      'year_group_label', coalesce(public.year_group_label(nullif(yg, 0)), 'No year set'),
      'last_season', jsonb_build_object(
        'id', last.id, 'name', last.name, 'completed_at', last.completed_at,
        'champion',  (select q.name from public.squads q where q.id = last.champion_squad_id),
        'runner_up', (select q.name from public.squads q where q.id = last.runner_up_squad_id),
        'third',     (select q.name from public.squads q where q.id = last.third_squad_id),
        'champions', (select coalesce(jsonb_agg(jsonb_build_object('bracket', c.bracket, 'champion', q.name)
                                                order by c.bracket), '[]'::jsonb)
                        from public.season_champions c join public.squads q on q.id = c.champion_squad_id
                       where c.season_id = last.id)),
      'fresh_squads_next', last.fresh_squads_next,
      'next_season_name', 'Season ' || ((select count(*) from public.seasons x
                                          where x.college_id = last.college_id
                                            and x.year_group is not distinct from last.year_group) + 1),
      'next_season_at', nxt);
  end if;
  select * into s from public.seasons where id = sid;
  wk := public.season_week(sid);
  return jsonb_build_object(
    'state',            'active',
    'season_id',        sid,
    'name',             s.name,
    'status',           s.status,
    'starts_on',        s.starts_on,
    'planned_weeks',    s.planned_weeks,
    'plan_version',     s.plan_version,
    'year_group',       yg,
    'year_group_label', coalesce(public.year_group_label(s.year_group), 'No year set'),
    'cross_sections',   s.cross_sections,
    'fresh_squads_next', s.fresh_squads_next,
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

notify pgrst, 'reload schema';
commit;
