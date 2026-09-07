-- ============================================================================
-- Stage 51 — the second scoreboard.
--
-- Section 24 of the blueprint: a season keeps two scoreboards, and only one of
-- them can end. The squad one decides the championship and stops for a squad
-- the moment it fails to qualify. The individual one never stops, for anybody.
-- Stage 50 built the first. This builds the second.
--
-- Six leaderboards (section 15) and seven pieces of recognition (section 16),
-- all computed from student_weekly_scores, which every student keeps filling in
-- for the whole season whether their squad is still in the championship or not.
-- Nothing here reads squads.qualified. That is the point:
--
--   "A student from a non-qualified squad can rank above a student from a
--    qualified squad. Individual performance remains independent."
--
-- Definitions, so the numbers can be defended when a student asks:
--
--   overall        every point scored this season
--   weekly         points in the most recent scored week
--   growth         average of the last three scored weeks minus the average of
--                  the first three - improvement, not raw strength
--   consistency    weeks scored at 80% or more of that student's own best week
--                  - sustained, measured against themselves
--   participation  weeks in which anything at all was scored
--   skill          best assessed score in a single skill
--
-- Awards are the top of those, plus Squad MVP (the biggest contributor in the
-- champion squad) and Rising Star (the best season total among students whose
-- opening week was in the bottom half - a strong performer from a low
-- baseline, which is exactly how the blueprint words it).
--
-- Three squad achievements from section 17 are added at the end: Championship
-- Qualifier, Finalist and Season Champion.
-- ============================================================================

-- A leaderboard must never cross a college boundary. Students see their own
-- college, a TPO sees theirs, an admin sees any.
create or replace function public.can_see_season(_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.seasons s
     where s.id = _season_id
       and ( public.is_admin()
             or s.college_id = public.my_college_id()
             or s.college_id = (select p.college_id from public.student_profiles p
                                 where p.id = (select auth.uid())) )
  );
$function$;

-- The season a caller is actually in, so the screens do not have to pass one.
create or replace function public.my_season_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select s.id
    from public.seasons s
   where s.is_current
     and s.college_id = coalesce(
           public.my_college_id(),
           (select p.college_id from public.student_profiles p where p.id = (select auth.uid())))
   order by s.starts_on desc
   limit 1;
$function$;

create or replace function public.season_leaderboard(
  _kind text default 'overall',
  _season_id uuid default null,
  _limit integer default 25
)
returns table(
  place integer,
  student_id uuid,
  full_name text,
  squad_name text,
  cohort text,
  value numeric,
  detail text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare sid uuid := coalesce(_season_id, public.my_season_id());
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

create or replace function public.season_awards(_season_id uuid default null)
returns table(
  award text,
  title text,
  student_id uuid,
  full_name text,
  squad_name text,
  value numeric,
  detail text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare sid uuid := coalesce(_season_id, public.my_season_id()); champ uuid;
begin
  if sid is null then return; end if;
  if not public.can_see_season(sid) then
    raise exception 'that season belongs to another college';
  end if;

  -- The champion squad if the season has closed, otherwise whoever leads.
  select coalesce(s.champion_squad_id,
                  (select q.id from public.squads q
                    where q.season_id = sid and q.archived_at is null
                    order by q.points desc, q.name limit 1))
    into champ
    from public.seasons s where s.id = sid;

  return query
  select 'orange_cap', 'Orange Cap', l.student_id, l.full_name, l.squad_name, l.value,
         'Highest cumulative individual performance'
    from public.season_leaderboard('overall', sid, 1) l

  union all
  select 'purple_cap', 'Purple Cap', l.student_id, l.full_name, l.squad_name, l.value,
         'Top specialist - ' || l.detail
    from public.season_leaderboard('skill', sid, 1) l

  union all
  select 'player_of_the_week', 'Player of the Week', l.student_id, l.full_name, l.squad_name, l.value,
         'Best performer in ' || l.detail
    from public.season_leaderboard('weekly', sid, 1) l

  union all
  select 'most_improved', 'Most Improved', l.student_id, l.full_name, l.squad_name, l.value,
         'Largest meaningful improvement over the season'
    from public.season_leaderboard('growth', sid, 1) l

  union all
  select 'consistency', 'Consistency Award', l.student_id, l.full_name, l.squad_name, l.value,
         'Strong sustained performance'
    from public.season_leaderboard('consistency', sid, 1) l

  union all
  select 'squad_mvp', 'Squad MVP', p.id, p.full_name, q.name, sum(w.points)::numeric,
         'Most valuable contributor in ' || q.name
    from public.student_weekly_scores w
    join public.student_profiles p on p.id = w.student_id
    join public.squads q on q.id = champ
   where w.season_id = sid and w.squad_id = champ
   group by p.id, p.full_name, q.name
   order by 6 desc
   limit 1;

  -- Rising Star is last because it needs the median opening week, which is a
  -- second pass over the same data.
  return query
  with opening as (
    select distinct on (w.student_id) w.student_id, w.points as first_week
      from public.student_weekly_scores w
     where w.season_id = sid
     order by w.student_id, w.week
  ), cut as (
    select percentile_cont(0.5) within group (order by first_week) as mid from opening
  )
  select 'rising_star', 'Rising Star', p.id, p.full_name, q.name,
         sum(w.points)::numeric, 'Strong performer from a lower baseline'
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

-- ------------------------------------------------- championship achievements

create or replace function public.squad_championship_achievements(_squad_id uuid)
returns table(kind text, title text, detail text, achieved_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select 'championship'::text, 'Championship Qualifier'::text,
         ('Top of ' || coalesce(q.cohort, 'the cohort') || ' - through to the championship')::text,
         q.updated_at
    from public.squads q
   where q.id = _squad_id and q.qualified

  union all
  select 'championship'::text, 'Finalist'::text,
         'Reached the grand final'::text, m.scheduled_at
    from public.squad_matches m
   where m.stage = 'final' and (m.home_squad = _squad_id or m.away_squad = _squad_id)

  union all
  select 'championship'::text, 'Season Champion'::text,
         'Won the season'::text, s.completed_at
    from public.seasons s
   where s.champion_squad_id = _squad_id;
$function$;

create or replace function public.my_squad_achievements()
returns table(kind text, title text, detail text, achieved_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare sq uuid;
begin
  select m.squad_id into sq from public.squad_members m
   where m.student_id = (select auth.uid()) and m.left_at is null limit 1;

  return query
    select 'win'::text,
           'Match won'::text,
           ('Beat ' || coalesce(o.name, 'the other squad') || ' ' ||
             greatest(coalesce(mt.home_points, 0), coalesce(mt.away_points, 0)) || '-' ||
             least(coalesce(mt.home_points, 0), coalesce(mt.away_points, 0)))::text,
           mt.scheduled_at
      from public.squad_matches mt
      left join public.squads o
        on o.id = case when mt.home_squad = sq then mt.away_squad else mt.home_squad end
     where mt.status = 'played'
       and (mt.home_squad = sq or mt.away_squad = sq)
       and case when mt.home_squad = sq
                then coalesce(mt.home_points, 0) > coalesce(mt.away_points, 0)
                else coalesce(mt.away_points, 0) > coalesce(mt.home_points, 0) end

    union all
    select 'week'::text,
           'Top of the table'::text,
           ('Week ' || w.week || ' - ' || w.points || ' points from ' ||
             w.active_members || ' of ' || w.total_members || ' members')::text,
           w.computed_at
      from public.squad_weekly_scores w
     where w.squad_id = sq and w.rank = 1

    union all
    select * from public.squad_championship_achievements(sq)

    union all
    select 'milestone'::text,
           m.label::text,
           (s.name || ' has ' || s.points || ' points')::text,
           s.updated_at
      from public.squads s
      cross join (values (100, 'First hundred'), (500, 'Five hundred points'),
                         (1000, 'A thousand points')) as m(threshold, label)
     where s.id = sq and s.points >= m.threshold

    union all
    select 'badge'::text, b.name::text, b.description::text, sb.awarded_at
      from public.student_badges sb
      join public.badges b on b.slug = sb.badge_slug
     where sb.student_id = (select auth.uid())

    order by 4 desc nulls last;
end $function$;

revoke all on function public.can_see_season(uuid)                   from public, anon, authenticated;
revoke all on function public.my_season_id()                         from public, anon, authenticated;
revoke all on function public.season_leaderboard(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.season_awards(uuid)                    from public, anon, authenticated;
revoke all on function public.squad_championship_achievements(uuid)  from public, anon, authenticated;

grant execute on function public.can_see_season(uuid)                    to authenticated, service_role;
grant execute on function public.my_season_id()                          to authenticated, service_role;
grant execute on function public.season_leaderboard(text, uuid, integer) to authenticated, service_role;
grant execute on function public.season_awards(uuid)                     to authenticated, service_role;
grant execute on function public.squad_championship_achievements(uuid)   to authenticated, service_role;
