-- Rollback of 218: tpo_attention (stage15), tpo_students (180) and tpo_home (164) as they were; my_lot_marks dropped.
begin;
drop function if exists public.my_lot_marks();
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

CREATE OR REPLACE FUNCTION public.tpo_students(_search text DEFAULT NULL::text, _branch text DEFAULT NULL::text, _batch text DEFAULT NULL::text, _squad text DEFAULT NULL::text, _status text DEFAULT NULL::text, _skill text DEFAULT NULL::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(student_id uuid, full_name text, roll_number text, branch text, batch text, email text, squad_id uuid, squad_name text, is_reserve boolean, days_quiet integer, total_xp integer, onboarding_status text, lots_done integer, attention text, gap_skills text[], total_count bigint, cohort text, cohort_waiting integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with mine as (select public.my_college_id() as cid),
  att as (select a.student_id, a.severity from public.tpo_attention() a),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch, p.batch, c.email, p.cohort,
           q.id as sq_id, q.name as sq_name, (m.id is null) as reserve,
           case when p.last_active is null then 999
                else (current_date - p.last_active::date) end as quiet,
           p.total_xp, p.onboarding_status,
           coalesce(att.severity, 'ok') as attn,
           coalesce((select array_agg(s.skill order by s.skill)
                       from public.student_skills s
                      where s.student_id = p.id and s.status = 'needs_improvement'),
                    '{}'::text[]) as gaps
      from mine cross join public.student_profiles p
      left join public.student_contact c on c.student_id = p.id
      left join public.squad_members m on m.student_id = p.id and m.left_at is null
      left join public.squads q on q.id = m.squad_id
      left join att on att.student_id = p.id
     where p.college_id = mine.cid and mine.cid is not null
  ),
  filtered as (
    select * from base b
     where (_search is null or _search = ''
            or b.full_name  ilike '%' || _search || '%'
            or b.roll_number ilike '%' || _search || '%'
            or b.email      ilike '%' || _search || '%')
       and (_branch is null or _branch = 'all' or b.branch = _branch)
       and (_batch  is null or _batch  = 'all' or b.batch  = _batch)
       and (_squad  is null or _squad  = 'all'
            or (_squad = 'reserve' and b.reserve)
            or b.sq_name = _squad)
       and (_skill  is null or _skill  = 'all' or _skill = any(b.gaps))
       and (_status is null or _status = 'all'
            or (_status = 'attention'    and b.attn <> 'ok')
            or (_status = 'inactive'     and b.quiet >= 7)
            or (_status = 'onboarding'   and b.onboarding_status <> 'completed')
            or (_status = 'active_today' and b.quiet = 0)
            or (_status = 'active_week'  and b.quiet <= 7))
  )
  select f.id, f.full_name, f.roll_number, f.branch, f.batch, f.email,
         f.sq_id, f.sq_name, f.reserve, f.quiet, f.total_xp,
         f.onboarding_status,
         -- Counted only for the page being shown, not for all ten thousand.
         -- Lots done = distinct Lots the student has passed (task_submissions).
         (select count(distinct s.task_id)::int from public.task_submissions s
           where s.student_id = f.id and s.status = 'passed'),
         f.attn, f.gaps,
         count(*) over () as total_count,
         f.cohort,
         -- 180 (MF-121): students of the same section who are not in a squad (the Reserve reason).
         (select count(*)::int from public.student_profiles p2, mine
           where p2.college_id = mine.cid and p2.cohort is not distinct from f.cohort
             and not exists (select 1 from public.squad_members m2 where m2.student_id = p2.id and m2.left_at is null))
    from filtered f
   order by f.full_name
   limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
$function$;

revoke all on function public.tpo_students(text, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.tpo_students(text, text, text, text, text, text, integer, integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tpo_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cid uuid := public.my_college_id();
  season record; result jsonb;
  attention_rows jsonb;
begin
  if cid is null then return jsonb_build_object('error','not a college account'); end if;
  select s.id, s.name, s.planned_weeks, public.season_week(s.id) as week
    into season from public.seasons s
   where s.college_id = cid and s.is_current order by s.starts_on desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'full_name', a.full_name, 'reason_codes', a.reason_codes)), '[]'::jsonb)
    into attention_rows
    from public.tpo_attention() a;
  select jsonb_build_object(
    'students', (select count(*) from public.student_profiles where college_id = cid),
    'active_this_week', (select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= now() - interval '7 days'),
    'active_today', (select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= current_date),
    'needs_attention', jsonb_array_length(attention_rows),
    'squads', (select count(*) from public.squads where college_id = cid),
    'reserves', (select count(*) from public.student_profiles p
       where p.college_id = cid
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)),
    'season', case when season.id is null then null else jsonb_build_object(
        'id', season.id, 'name', season.name,
        'week', season.week, 'planned_weeks', season.planned_weeks) end,
    'leader', (select jsonb_build_object('id', q.id, 'name', q.name, 'points', q.points)
        -- 164 (MF-008): only the running season's squads lead; after a season ends there is no leader.
        from public.squads q where q.college_id = cid and q.season_id = season.id order by q.points desc nulls last limit 1),
    'attention_breakdown', (select coalesce(jsonb_agg(t order by t.students desc), '[]'::jsonb) from (
        select code as reason_code,
               case code when 'inactive'    then 'quiet for over a week'
                         when 'onboarding'  then 'have not finished onboarding'
                         when 'missed_lots' then 'missed this week''s Lot'
                         else code end as reason,
               count(*) as students,
               -- Only enough names to show. Ten thousand students behind one
               -- line would have shipped a megabyte of JSON to render "and
               -- 7,496 more".
               (array_agg(nm order by nm))[1:5] as who
          from (select r ->> 'full_name' as nm,
                       jsonb_array_elements_text(r -> 'reason_codes') as code
                  from jsonb_array_elements(attention_rows) r) x
         group by code) t)
  ) into result;
  return result;
end $function$;

commit;
notify pgrst, 'reload schema';
