-- ============================================================================
-- Stage 18 — the college dashboard at ten thousand students.
--
-- Measured against a load college of ten thousand students, nine hundred
-- squads and two hundred thousand activity events:
--
--   tpo_home()      830 ms  ->  252 ms
--   tpo_insights() 1180 ms  ->  217 ms
--   tpo_students()  10,000 rows sent  ->  50
--
-- One hard bug was found on the way that had nothing to do with scale:
-- seasons_one_current was UNIQUE (is_current) WHERE is_current — one current
-- season across the entire platform rather than one per college. Written
-- before seasons had a college_id, never revisited when stage 15 added one.
-- The second college to start a season would have been refused outright.
-- ============================================================================

drop index if exists public.seasons_one_current;
create unique index seasons_one_current_per_college
  on public.seasons (college_id) where is_current;


-- tpo_home called tpo_attention() twice — once to count it, again to build the
-- breakdown — and each call walks every student with two correlated subqueries.
-- Computed once, read twice. The breakdown also carried every name behind every
-- line, seven and a half thousand of them, to render "and 7,496 more".
create or replace function public.tpo_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid := public.my_college_id();
  season record; result jsonb; attention_rows jsonb;
begin
  if cid is null then return jsonb_build_object('error','not a college account'); end if;

  select s.id, s.name, s.planned_weeks, public.season_week(s.id) as week
    into season from public.seasons s
   where s.college_id = cid and s.is_current order by s.starts_on desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'full_name', a.full_name, 'reason_codes', a.reason_codes)), '[]'::jsonb)
    into attention_rows from public.tpo_attention() a;

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
        from public.squads q where q.college_id = cid order by q.points desc nulls last limit 1),
    'attention_breakdown', (select coalesce(jsonb_agg(t order by t.students desc), '[]'::jsonb) from (
        select code as reason_code,
               case code when 'inactive'    then 'quiet for over a week'
                         when 'onboarding'  then 'have not finished onboarding'
                         when 'missed_lots' then 'missed this week''s Lot'
                         else code end as reason,
               count(*) as students,
               (array_agg(nm order by nm))[1:5] as who
          from (select r ->> 'full_name' as nm,
                       jsonb_array_elements_text(r -> 'reason_codes') as code
                  from jsonb_array_elements(attention_rows) r) x
         group by code) t)
  ) into result;
  return result;
end $fn$;


-- Insights walked nine hundred squads running two correlated subqueries each.
-- The same answer comes from two grouped scans joined together — and it returns
-- the twenty worth looking at rather than all nine hundred, least active first,
-- because a summary screen with nine hundred rows is not a summary.
create or replace function public.tpo_insights()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id(); total integer;
begin
  if cid is null then return jsonb_build_object('error','not a college account'); end if;
  select count(*) into total from public.student_profiles where college_id = cid;

  return jsonb_build_object(
    'students', total,
    'active_today', (select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= current_date),
    'participation_this_week', case when total = 0 then 0 else round(100.0 * (
        select count(distinct student_id) from public.student_activity_events
         where college_id = cid and occurred_at >= now() - interval '7 days') / total) end,
    'participation_last_week', case when total = 0 then 0 else round(100.0 * (
        select count(distinct student_id) from public.student_activity_events
         where college_id = cid and occurred_at >= now() - interval '14 days'
           and occurred_at < now() - interval '7 days') / total) end,
    'skill_gaps', (select coalesce(jsonb_agg(g), '[]'::jsonb) from (
        select s.skill, count(*) as students from public.student_skills s
          join public.student_profiles p on p.id = s.student_id
         where p.college_id = cid and s.status = 'needs_improvement'
         group by s.skill order by 2 desc limit 8) g),
    'squad_health', (select coalesce(jsonb_agg(h order by h.points desc nulls last), '[]'::jsonb) from (
        with mine as (select id, name, points, wins, losses
                        from public.squads where college_id = cid),
        member_count as (
          select m.squad_id, count(*) as members from public.squad_members m
            join mine on mine.id = m.squad_id where m.left_at is null group by m.squad_id),
        active_count as (
          select m.squad_id, count(distinct e.student_id) as active_members
            from public.squad_members m
            join mine on mine.id = m.squad_id
            join public.student_activity_events e
              on e.student_id = m.student_id and e.occurred_at >= now() - interval '7 days'
           where m.left_at is null group by m.squad_id)
        select mine.id, mine.name, mine.points, mine.wins, mine.losses,
               coalesce(mc.members, 0) as members,
               coalesce(ac.active_members, 0) as active_members
          from mine
          left join member_count mc on mc.squad_id = mine.id
          left join active_count ac on ac.squad_id = mine.id
         order by (case when coalesce(mc.members,0) = 0 then 1
                        else coalesce(ac.active_members,0)::numeric / mc.members end) asc,
                  mine.points desc
         limit 20) h),
    'squad_count', (select count(*) from public.squads where college_id = cid),
    'attention_total', (select count(*) from public.tpo_attention())
  );
end $fn$;


-- tpo_students returned every student in the college and the browser filtered
-- them. At six students that is invisible; at ten thousand it is megabytes of
-- JSON on every visit and ten thousand objects re-filtered on every keystroke.
drop function if exists public.tpo_students();

create or replace function public.tpo_students(
  _search text default null,
  _branch text default null,
  _batch  text default null,
  _squad  text default null,   -- a squad name, or 'reserve'
  _status text default null,   -- attention | inactive | onboarding | active_today | active_week
  _skill  text default null,
  _limit  integer default 50,
  _offset integer default 0
) returns table (
  student_id uuid, full_name text, roll_number text, branch text, batch text,
  email text, squad_id uuid, squad_name text, is_reserve boolean,
  days_quiet integer, trust_score numeric, total_xp integer,
  onboarding_status text, lots_done integer, attention text,
  gap_skills text[], total_count bigint
) language sql stable security definer set search_path = public, pg_temp as $fn$
  with mine as (select public.my_college_id() as cid),
  att as (select a.student_id, a.severity from public.tpo_attention() a),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch, p.batch, c.email,
           q.id as sq_id, q.name as sq_name, (m.id is null) as reserve,
           case when p.last_active is null then 999
                else (current_date - p.last_active::date) end as quiet,
           p.trust_score, p.total_xp, p.onboarding_status,
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
            or b.full_name   ilike '%' || _search || '%'
            or b.roll_number ilike '%' || _search || '%'
            or b.email       ilike '%' || _search || '%')
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
         f.sq_id, f.sq_name, f.reserve, f.quiet, f.trust_score, f.total_xp,
         f.onboarding_status,
         -- Counted only for the page being shown, not for all ten thousand.
         (select count(*)::int from public.task_assignments ta
           where ta.student_id = f.id and ta.status = 'completed'),
         f.attn, f.gaps,
         count(*) over () as total_count
    from filtered f
   order by f.full_name
   limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
$fn$;

-- The dropdowns need every value in the college, not just the ones on the page
-- being shown — otherwise choosing MECH is impossible while page one happens to
-- be all CSE.
create or replace function public.tpo_student_filters()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
    'branches', coalesce((select jsonb_agg(distinct branch order by branch)
                            from public.student_profiles
                           where college_id = public.my_college_id()
                             and branch is not null and branch <> ''), '[]'::jsonb),
    'batches',  coalesce((select jsonb_agg(distinct batch order by batch)
                            from public.student_profiles
                           where college_id = public.my_college_id()
                             and batch is not null and batch <> ''), '[]'::jsonb),
    'squads',   coalesce((select jsonb_agg(name order by name)
                            from public.squads
                           where college_id = public.my_college_id()), '[]'::jsonb),
    'skills',   coalesce((select jsonb_agg(distinct s.skill order by s.skill)
                            from public.student_skills s
                            join public.student_profiles p on p.id = s.student_id
                           where p.college_id = public.my_college_id()
                             and s.status = 'needs_improvement'), '[]'::jsonb)
  );
$fn$;

revoke all on function public.tpo_home() from public, anon;
revoke all on function public.tpo_insights() from public, anon;
revoke all on function public.tpo_students(text,text,text,text,text,text,integer,integer) from public, anon;
revoke all on function public.tpo_student_filters() from public, anon;

grant execute on function public.tpo_home() to authenticated;
grant execute on function public.tpo_insights() to authenticated;
grant execute on function public.tpo_students(text,text,text,text,text,text,integer,integer) to authenticated;
grant execute on function public.tpo_student_filters() to authenticated;
