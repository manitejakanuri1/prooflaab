-- Home grouped its "needs attention" breakdown by the sentence shown to the
-- officer, so "No activity for 8 days" and "No activity for 9 days" counted as
-- two separate problems. What the officer wants is one line — "2 students quiet
-- for over a week" — so the grouping needs a stable code separate from the
-- wording, and tpo_attention now returns both.
--
-- The breakdown also carries the names. The whole argument of this screen is
-- that tapping a line opens the filtered list; a count with no names behind it
-- would need a second round trip to be useful.
drop function if exists public.tpo_attention();

create or replace function public.tpo_attention()
returns table (student_id uuid, full_name text, roll_number text, branch text,
               days_quiet integer, reason_codes text[], reasons text[], severity text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with mine as (select public.my_college_id() as cid),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch,
           case when p.last_active is null then 999
                else (current_date - p.last_active::date) end as quiet,
           p.onboarding_status,
           (select count(*) from public.task_assignments ta
             where ta.student_id = p.id
               and ta.assigned_at >= date_trunc('week', now())
               and ta.status <> 'completed') as missed_this_week
      from public.student_profiles p, mine
     where p.college_id = mine.cid and mine.cid is not null
  )
  select b.id, b.full_name, b.roll_number, b.branch, b.quiet,
         array_remove(array[
           case when b.quiet >= 7                       then 'inactive' end,
           case when b.onboarding_status <> 'completed' then 'onboarding' end,
           case when b.missed_this_week >= 2            then 'missed_lots' end
         ], null),
         array_remove(array[
           case when b.quiet >= 7 then 'No activity for ' || b.quiet || ' days' end,
           case when b.onboarding_status <> 'completed'
                then 'Onboarding not finished (' || b.onboarding_status || ')' end,
           case when b.missed_this_week >= 2
                then b.missed_this_week || ' Lots not submitted this week' end
         ], null),
         case when b.quiet >= 14 or b.missed_this_week >= 3 then 'high'
              when b.quiet >= 7  or b.missed_this_week >= 2
                   or b.onboarding_status <> 'completed'     then 'medium'
              else 'low' end
    from base b
   where b.quiet >= 7 or b.onboarding_status <> 'completed' or b.missed_this_week >= 2
   order by b.quiet desc;
$fn$;

create or replace function public.tpo_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id(); season record; result jsonb;
begin
  if cid is null then return jsonb_build_object('error','not a college account'); end if;
  select s.id, s.name, s.planned_weeks, public.season_week(s.id) as week
    into season from public.seasons s
   where s.college_id = cid and s.is_current order by s.starts_on desc limit 1;

  select jsonb_build_object(
    'students', (select count(*) from public.student_profiles where college_id = cid),
    'active_this_week', (select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= now() - interval '7 days'),
    'active_today', (select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= current_date),
    'needs_attention', (select count(*) from public.tpo_attention()),
    'squads', (select count(*) from public.squads where college_id = cid),
    'reserves', (select count(*) from public.student_profiles p
       where p.college_id = cid
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)),
    'season', case when season.id is null then null else jsonb_build_object(
        'id', season.id, 'name', season.name,
        'week', season.week, 'planned_weeks', season.planned_weeks) end,
    'leader', (select jsonb_build_object('id', q.id, 'name', q.name, 'points', q.points)
        from public.squads q where q.college_id = cid order by q.points desc nulls last limit 1),
    'attention_breakdown', (select coalesce(jsonb_agg(t order by t.students desc), '[]'::jsonb) from (
        select code as reason_code,
               case code when 'inactive'    then 'quiet for over a week'
                         when 'onboarding'  then 'have not finished onboarding'
                         when 'missed_lots' then 'missed this week''s Lot'
                         else code end as reason,
               count(*) as students,
               array_agg(full_name order by full_name) as who
          from public.tpo_attention() a, unnest(a.reason_codes) as code
         group by code) t)
  ) into result;
  return result;
end $fn$;

-- Rebuilt only because dropping tpo_attention dropped everything depending on it.
create or replace function public.tpo_students()
returns table (student_id uuid, full_name text, roll_number text, branch text, batch text,
               email text, squad_id uuid, squad_name text, is_reserve boolean,
               days_quiet integer, trust_score numeric, total_xp integer,
               onboarding_status text, lots_done integer, attention text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with mine as (select public.my_college_id() as cid),
  att as (select a.student_id, a.severity from public.tpo_attention() a)
  select p.id, p.full_name, p.roll_number, p.branch, p.batch, c.email,
         q.id, q.name, (m.id is null),
         case when p.last_active is null then 999
              else (current_date - p.last_active::date) end,
         p.trust_score, p.total_xp, p.onboarding_status,
         (select count(*)::int from public.task_assignments ta
           where ta.student_id = p.id and ta.status = 'completed'),
         coalesce(att.severity, 'ok')
    from mine cross join public.student_profiles p
    left join public.student_contact c on c.student_id = p.id
    left join public.squad_members m on m.student_id = p.id and m.left_at is null
    left join public.squads q on q.id = m.squad_id
    left join att on att.student_id = p.id
   where p.college_id = mine.cid and mine.cid is not null
   order by p.full_name;
$fn$;

revoke all on function public.tpo_attention() from public, anon;
grant execute on function public.tpo_attention() to authenticated;
