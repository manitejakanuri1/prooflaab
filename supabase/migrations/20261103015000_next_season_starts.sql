-- 160 (MF-016): Season 2 starts after Season 1 ends.
-- Before: close_season marked the season complete but kept every student in its squads (left_at stayed null),
-- and form_all_colleges only looked at colleges with a running season. So nobody opened Season 2, and even
-- a hand-run form_squads seated 0 students (all still "in a squad").
-- Now:
--   close_season       sets left_at on that season's members and archived_at on its squads.
--   form_all_colleges  also runs for a college whose last season is complete and has no running one;
--                      form_squads -> ensure_season opens "Season N+1" and seats students (11 per squad,
--                      the rest in Reserve, unchanged).
--   season_leaderboard, season_awards: the squad name comes from the student's squad in THAT season,
--                      not from a current membership, so a finished season still shows squad names.
-- Rollback: migration/160-rollback-next-season-starts.sql
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

CREATE OR REPLACE FUNCTION public.form_all_colleges()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record; made integer := 0; placed integer := 0; failed integer := 0; first_error text; r jsonb;
begin
  for c in
    -- 160 (MF-016): also a college whose last season has finished, so form_squads -> ensure_season opens the next.
    select distinct s.college_id from public.seasons s
     where s.college_id is not null
       and ((s.is_current and s.status = 'active')
            or (s.status = 'complete'
                and not exists (select 1 from public.seasons x where x.college_id = s.college_id and x.is_current)))
  loop
    begin
      r := public.form_squads(c.college_id);
      made   := made   + coalesce((r->>'squads_created')::int, 0);
      placed := placed + coalesce((r->>'students_placed')::int, 0);
    exception when others then
      -- One college's problem must not stop every other college's morning, but it must be seen (108).
      failed := failed + 1;
      first_error := coalesce(first_error, c.college_id || ': ' || left(sqlerrm, 200));
      raise notice 'squad formation failed for %: %', c.college_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'squads_created', made, 'students_placed', placed,
                            'colleges_failed', failed, 'first_error', first_error,
                            'status', case when failed > 0 then 'partial_failure' else 'success' end,
                            'ran_at', now());
end $function$;

CREATE OR REPLACE FUNCTION public.season_leaderboard(_kind text DEFAULT 'overall'::text, _season_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 25)
 RETURNS TABLE(place integer, student_id uuid, full_name text, squad_name text, cohort text, value numeric, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid := coalesce(_season_id, public.my_season_id(), public.my_last_season_id());
begin
  if sid is null then return; end if;
  if not public.can_see_season(sid) then
    raise exception 'that season belongs to another college';
  end if;
  return query
  with weeks as (
    select w.student_id, w.week, w.points,
           row_number() over (partition by w.student_id order by w.week)       as asc_pos,
           row_number() over (partition by w.student_id order by w.week desc)  as desc_pos,
           max(w.points) over (partition by w.student_id)                      as best_week
      from public.student_weekly_scores w
     where w.season_id = sid
  ), latest as (
    select max(week) as wk from public.student_weekly_scores where season_id = sid
  ), agg as (
    select k.student_id,
           sum(k.points)                                                        as overall,
           max(k.points) filter (where k.week = (select wk from latest))        as weekly,
           avg(k.points) filter (where k.desc_pos <= 3)
             - avg(k.points) filter (where k.asc_pos <= 3)                      as growth,
           count(*) filter (where k.points >= 0.8 * greatest(k.best_week, 1))   as consistency,
           count(*) filter (where k.points > 0)                                 as participation
      from weeks k
     group by k.student_id
  ), skill as (
    select s.student_id, max(s.assessed_score)::numeric as best_skill,
           (array_agg(s.skill order by s.assessed_score desc nulls last))[1] as best_skill_name
      from public.student_skills s
     group by s.student_id
  ), scored as (
    select a.student_id,
           case lower(_kind)
             when 'weekly'        then coalesce(a.weekly, 0)::numeric
             when 'growth'        then coalesce(a.growth, 0)::numeric
             when 'consistency'   then a.consistency::numeric
             when 'participation' then a.participation::numeric
             when 'skill'         then coalesce(sk.best_skill, 0)
             else a.overall::numeric
           end as value,
           case lower(_kind)
             when 'weekly'        then 'week ' || (select wk from latest)
             when 'growth'        then 'last three weeks against the first three'
             when 'consistency'   then 'weeks at 80% or more of their own best'
             when 'participation' then 'weeks with something scored'
             when 'skill'         then coalesce(sk.best_skill_name, 'no assessed skill yet')
             else a.participation || ' weeks played'
           end as detail
      from agg a
      left join skill sk on sk.student_id = a.student_id
  )
  select row_number() over (order by sc.value desc nulls last, p.full_name)::integer,
         sc.student_id, p.full_name, q.name, q.cohort, round(sc.value, 1), sc.detail
    from scored sc
    join public.student_profiles p on p.id = sc.student_id
    -- 160: the squad the student played for in THIS season (members are released when it closes).
    left join lateral (select q1.name, q1.cohort from public.squad_members m1
                         join public.squads q1 on q1.id = m1.squad_id
                        where m1.student_id = sc.student_id and q1.season_id = sid
                        order by m1.left_at is null desc, m1.joined_at desc limit 1) q on true
   where sc.value is not null
   order by sc.value desc nulls last, p.full_name
   limit greatest(_limit, 1);
end $function$;

CREATE OR REPLACE FUNCTION public.season_awards(_season_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(award text, title text, student_id uuid, full_name text, squad_name text, value numeric, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid := coalesce(_season_id, public.my_season_id(), public.my_last_season_id()); champ uuid;
begin
  if sid is null then return; end if;
  if not public.can_see_season(sid) then
    raise exception 'that season belongs to another college';
  end if;
  select coalesce(s.champion_squad_id,
                  (select q.id from public.squads q
                    where q.season_id = sid and q.archived_at is null
                    order by q.points desc, q.name limit 1))
    into champ
    from public.seasons s where s.id = sid;
  return query
  select 'orange_cap'::text, 'Orange Cap'::text, l.student_id, l.full_name, l.squad_name, l.value,
         'Highest cumulative individual performance'::text
    from public.season_leaderboard('overall', sid, 1) l
  union all
  select 'purple_cap'::text, 'Purple Cap'::text, l.student_id, l.full_name, l.squad_name, l.value,
         ('Top specialist - ' || l.detail)::text
    from public.season_leaderboard('skill', sid, 1) l
  union all
  select 'player_of_the_week'::text, 'Player of the Week'::text, l.student_id, l.full_name, l.squad_name, l.value,
         ('Best performer in ' || l.detail)::text
    from public.season_leaderboard('weekly', sid, 1) l
  union all
  select 'most_improved'::text, 'Most Improved'::text, l.student_id, l.full_name, l.squad_name, l.value,
         'Largest meaningful improvement over the season'::text
    from public.season_leaderboard('growth', sid, 1) l
  union all
  select 'consistency'::text, 'Consistency Award'::text, l.student_id, l.full_name, l.squad_name, l.value,
         'Strong sustained performance'::text
    from public.season_leaderboard('consistency', sid, 1) l;
  return query
  select 'squad_mvp'::text, 'Squad MVP'::text, p.id, p.full_name, q.name, sum(w.points)::numeric,
         ('Most valuable contributor in ' || q.name)::text
    from public.student_weekly_scores w
    join public.student_profiles p on p.id = w.student_id
    join public.squads q on q.id = champ
   where w.season_id = sid and w.squad_id = champ
   group by p.id, p.full_name, q.name
   order by 6 desc
   limit 1;
  return query
  with opening as (
    select distinct on (w.student_id) w.student_id, w.points as first_week
      from public.student_weekly_scores w
     where w.season_id = sid
     order by w.student_id, w.week
  ), cut as (
    select percentile_cont(0.5) within group (order by first_week) as mid from opening
  )
  select 'rising_star'::text, 'Rising Star'::text, p.id, p.full_name, q.name,
         sum(w.points)::numeric, 'Strong performer from a lower baseline'::text
    from public.student_weekly_scores w
    join opening o on o.student_id = w.student_id
    join public.student_profiles p on p.id = w.student_id
    -- 160: the squad the student played for in THIS season (members are released when it closes).
    left join lateral (select q1.name, q1.cohort from public.squad_members m1
                         join public.squads q1 on q1.id = m1.squad_id
                        where m1.student_id = p.id and q1.season_id = sid
                        order by m1.left_at is null desc, m1.joined_at desc limit 1) q on true
   cross join cut
   where w.season_id = sid and o.first_week <= cut.mid
   group by p.id, p.full_name, q.name
   order by 6 desc
   limit 1;
end $function$;

do $$
begin
  if pg_get_functiondef('public.close_season(uuid)'::regprocedure) !~ 'set left_at = now\(\)' then
    raise exception '160: close_season still keeps students in their squads';
  end if;
  if pg_get_functiondef('public.form_all_colleges()'::regprocedure) !~ 'status = ''complete''' then
    raise exception '160: the morning job still skips finished seasons';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
