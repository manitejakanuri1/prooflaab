-- 162 (MF-010): no award and no leaderboard place for a student with 0 points.
-- Before: every award took row 1 of a leaderboard that listed every student with a weekly row, 0 points
-- included, sorted by value then NAME, so with all-zero values Purple Cap, Player of the Week and Most
-- Improved went to the alphabetically first student (never active).
-- Now season_leaderboard lists only students with season points above 0 and a value above 0, ties broken by
-- season points then weeks played (never by name); season_awards' Squad MVP and Rising Star need points above 0.
-- When nobody qualifies the award is simply missing; the screen shows "Not awarded".
-- Rollback: migration/162-rollback-no-awards-for-zero.sql
begin;

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
    select a.student_id, a.overall, a.participation,
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
  -- 162 (MF-010): only students who scored this season, and only a value above 0 (an all-zero board is empty).
  -- Ties are broken by season points, then weeks played - never by name.
  select row_number() over (order by sc.value desc, sc.overall desc, sc.participation desc, sc.student_id)::integer,
         sc.student_id, p.full_name, q.name, q.cohort, round(sc.value, 1), sc.detail
    from scored sc
    join public.student_profiles p on p.id = sc.student_id
    -- 160: the squad the student played for in THIS season (members are released when it closes).
    left join lateral (select q1.name, q1.cohort from public.squad_members m1
                         join public.squads q1 on q1.id = m1.squad_id
                        where m1.student_id = sc.student_id and q1.season_id = sid
                        order by m1.left_at is null desc, m1.joined_at desc limit 1) q on true
   where sc.value > 0 and sc.overall > 0
   order by sc.value desc, sc.overall desc, sc.participation desc, sc.student_id
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
                    order by q.points desc, q.rank nulls last limit 1))
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
  having sum(w.points) > 0 -- 162 (MF-010): never to a student with 0 points; ties by weeks played, not name
   order by 6 desc, count(*) desc, p.id
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
  having sum(w.points) > 0 -- 162 (MF-010): never to a student with 0 points; ties by weeks played, not name
   order by 6 desc, count(*) desc, p.id
   limit 1;
end $function$;

do $$
begin
  if pg_get_functiondef('public.season_leaderboard(text,uuid,integer)'::regprocedure) !~ 'sc.value > 0 and sc.overall > 0' then
    raise exception '162: leaderboard still lists 0-point students';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
