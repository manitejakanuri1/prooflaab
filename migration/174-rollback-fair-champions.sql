-- Rollback of 174: champion by points without a league; seeding ties broken by name.
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
  -- 160 (MF-016): the season lets its students go, so the next morning's formation can seat them again.
  update public.squad_members m set left_at = now()
    from public.squads q
   where q.id = m.squad_id and q.season_id = _season_id and m.left_at is null;
  update public.squads set archived_at = now()
   where season_id = _season_id and archived_at is null;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', case when fin.id is not null then 'final' else 'points' end),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', case when fin.id is not null then 'final' else 'points' end);
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
                             when m.away_squad = q.id then m.away_points end), 0) as pts
      from public.squads q
      left join public.squad_matches m
        on m.season_id = _season_id and m.stage = 'championship' and m.status = 'played'
       and (m.home_squad = q.id or m.away_squad = q.id)
     where q.season_id = _season_id and q.qualified and q.archived_at is null
     group by q.id
  ), ranked as (
    select c.id, row_number() over (order by c.pts desc, q.points desc, q.name) as pos
      from champ c join public.squads q on q.id = c.id
  )
  update public.squads q set seed = ranked.pos from ranked where q.id = ranked.id;
  get diagnostics seeded = row_count;
  perform public.write_audit('CHAMPIONSHIP_SEEDED', 'squads', _season_id, null,
    jsonb_build_object('seeded', seeded),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'seeded', seeded);
end $function$;
commit;
