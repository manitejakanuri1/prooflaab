-- 124: after a season ends, the student Leaderboards tab shows that season's final table.
--
-- season_leaderboard and season_awards pick the season with my_season_id(), which answers only a
-- season marked is_current. Once a season is closed nothing is current, so on staging, 19 Oct 2026
-- (SIM12 season complete, 12 weeks scored), every student's Leaderboards tab read "Nothing scored
-- yet this season". No season had ever finished before the 12-week test, so this was never seen.
--
-- my_last_season_id(): the caller's college's latest season, running or finished. Both functions
-- fall back to it only when there is no current season; a running season is unchanged.
-- can_see_season() still guards every read (a college only ever sees its own seasons).
begin;

create or replace function public.my_last_season_id()
returns uuid
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select s.id from public.seasons s
   where s.college_id = coalesce(public.my_college_id(),
                                 (select p.college_id from public.student_profiles p where p.id = (select auth.uid())))
   order by s.starts_on desc limit 1;
$function$;

revoke all on function public.my_last_season_id() from public, anon, authenticated;
grant execute on function public.my_last_season_id() to service_role;

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
    left join public.squad_members m on m.student_id = sc.student_id and m.left_at is null
    left join public.squads q on q.id = m.squad_id and q.season_id = sid
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
    left join public.squad_members m on m.student_id = p.id and m.left_at is null
    left join public.squads q on q.id = m.squad_id and q.season_id = sid
   cross join cut
   where w.season_id = sid and o.first_week <= cut.mid
   group by p.id, p.full_name, q.name
   order by 6 desc
   limit 1;
end $function$;

-- Self-check: a student of a college whose only season is finished gets a leaderboard.
do $$
declare stu uuid; n int;
begin
  select p.id into stu from public.student_profiles p
    join public.seasons s on s.college_id = p.college_id
   where s.status = 'complete'
     and not exists (select 1 from public.seasons c where c.college_id = p.college_id and c.is_current)
     and exists (select 1 from public.student_weekly_scores w where w.season_id = s.id)
   limit 1;
  if stu is null then raise notice '124 self-check skipped: no finished season with scores'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  select count(*) into n from public.season_leaderboard('overall', null, 5);
  perform set_config('request.jwt.claims', '', true);
  if n = 0 then raise exception '124 self-check: finished season still gives an empty leaderboard'; end if;
  raise notice '124 self-check passed (% rows)', n;
end $$;

commit;
notify pgrst, 'reload schema';
