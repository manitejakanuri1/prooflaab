-- 174 (MF-053, MF-049, 30 Oct 2026):
--   MF-053: close_season named a "champion" by points even when no league match was ever played (a college with
--           one squad). Now nobody is champion then (decided_by 'no_league'); the screens already say "No champion".
--   MF-049: championship seeding broke a points tie by squad name. Now: points, wins, head-to-head points against
--           the squads still level, season points, and the name only last.
-- Rollback: migration/174-rollback-fair-champions.sql
begin;

CREATE OR REPLACE FUNCTION public.close_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  podium uuid[]; names text[];
  fin record; champ uuid; runner uuid; third uuid;
begin
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
    -- Third: the semi-final losers, better seed first.
    select q.id into third
      from public.squad_matches m
      join public.squads q on q.id in (m.home_squad, m.away_squad)
     where m.season_id = _season_id and m.stage = 'knockout' and m.status in ('played', 'no_activity')
       and q.id not in (champ, runner)
     order by q.seed nulls last, q.points desc
     limit 1;
    podium := array[champ, runner, third];
  elsif exists (select 1 from public.squad_matches
                 where season_id = _season_id and stage = 'league' and status = 'played') then
    select array_agg(id order by points desc nulls last, name)
      into podium
      from public.squads where season_id = _season_id;
  else
    -- 174 (MF-053): no league match was ever played (for example a college with one squad): nobody is champion.
    podium := null;
  end if;
  select array_agg(q.name order by p.i) into names
    from unnest(podium) with ordinality p(id, i) join public.squads q on q.id = p.id;
  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  -- 160 (MF-016): the season lets its students go, so the next morning's formation can seat them again.
  update public.squad_members m set left_at = now()
    from public.squads q
   where q.id = m.squad_id and q.season_id = _season_id and m.left_at is null;
  update public.squads set archived_at = now()
   where season_id = _season_id and archived_at is null;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', case when fin.id is not null then 'final' when podium is null then 'no_league' else 'points' end),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', case when fin.id is not null then 'final' when podium is null then 'no_league' else 'points' end);
end $function$;

CREATE OR REPLACE FUNCTION public.seed_championship(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare seeded integer;
begin
  with champ as (
    select q.id,
           coalesce(sum(case when m.home_squad = q.id then m.home_points
                             when m.away_squad = q.id then m.away_points end), 0) as pts,
           -- 174 (MF-049): wins break a points tie
           count(*) filter (where m.winner_squad = q.id
                              or (m.winner_squad is null and m.home_squad = q.id and m.home_points > m.away_points)
                              or (m.winner_squad is null and m.away_squad = q.id and m.away_points > m.home_points)) as wins
      from public.squads q
      left join public.squad_matches m
        on m.season_id = _season_id and m.stage = 'championship' and m.status = 'played'
       and (m.home_squad = q.id or m.away_squad = q.id)
     where q.season_id = _season_id and q.qualified and q.archived_at is null
     group by q.id
  ), h2h as (
    -- then head-to-head: points scored against the squads still level on points and wins
    select c.id,
           coalesce((select sum(case when m.home_squad = c.id then m.home_points else m.away_points end)
                       from public.squad_matches m
                       join champ o on o.id = case when m.home_squad = c.id then m.away_squad else m.home_squad end
                      where m.season_id = _season_id and m.stage = 'championship' and m.status = 'played'
                        and (m.home_squad = c.id or m.away_squad = c.id)
                        and o.pts = c.pts and o.wins = c.wins), 0) as h2h
      from champ c
  ), ranked as (
    -- points, wins, head-to-head, season points; the name only last
    select c.id, row_number() over (order by c.pts desc, c.wins desc, h.h2h desc, q.points desc, q.name) as pos
      from champ c join h2h h on h.id = c.id join public.squads q on q.id = c.id
  )
  update public.squads q set seed = ranked.pos from ranked where q.id = ranked.id;
  get diagnostics seeded = row_count;
  perform public.write_audit('CHAMPIONSHIP_SEEDED', 'squads', _season_id, null,
    jsonb_build_object('seeded', seeded),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'seeded', seeded);
end $function$;

do $$
begin
  if pg_get_functiondef('public.close_season(uuid)'::regprocedure) !~ 'no_league'
     or pg_get_functiondef('public.seed_championship(uuid)'::regprocedure) !~ 'h.h2h desc' then
    raise exception '174: champion rules not in place';
  end if;
end $$;

commit;
