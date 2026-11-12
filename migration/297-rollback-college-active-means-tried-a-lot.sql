-- Rollback of 297: the four college functions as they were before (definitions copied from TEST, 12 Nov 2026).
begin;
CREATE OR REPLACE FUNCTION public.tpo_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
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
    'active_this_week', (select count(distinct s.student_id) from public.task_submissions s
       join public.student_profiles sp on sp.id = s.student_id
       where sp.college_id = cid and s.created_at >= now() - interval '7 days'),
    'active_today', (select count(distinct s.student_id) from public.task_submissions s
       join public.student_profiles sp on sp.id = s.student_id
       where sp.college_id = cid and s.created_at >= current_date),
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
               case code when 'inactive'    then 'have not tried a Lot for over a week'
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

CREATE OR REPLACE FUNCTION public.tpo_insights()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
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
        with mine as (select id, name, points, wins, draws, losses
                        from public.squads where college_id = cid and archived_at is null),
        member_count as (
          select m.squad_id, count(*) as members
            from public.squad_members m
            join mine on mine.id = m.squad_id
           where m.left_at is null group by m.squad_id),
        active_count as (
          select m.squad_id, count(distinct e.student_id) as active_members
            from public.squad_members m
            join mine on mine.id = m.squad_id
            join public.student_activity_events e
              on e.student_id = m.student_id and e.occurred_at >= now() - interval '7 days'
           where m.left_at is null group by m.squad_id)
        -- Only the squads worth showing. A college with nine hundred squads
        -- does not want nine hundred rows on a summary screen; it wants the
        -- ones in trouble and the ones leading.
        select mine.id, mine.name, mine.points, mine.wins, mine.draws, mine.losses,
               coalesce(mc.members, 0) as members,
               coalesce(ac.active_members, 0) as active_members
          from mine
          left join member_count mc on mc.squad_id = mine.id
          left join active_count ac on ac.squad_id = mine.id
         order by (case when coalesce(mc.members,0) = 0 then 1
                        else coalesce(ac.active_members,0)::numeric / mc.members end) asc,
                  mine.points desc
         limit 20) h),
    'squad_count', (select count(*) from public.squads where college_id = cid and archived_at is null),
    'attention_total', (select count(*) from public.tpo_attention())
  );
end $function$;

CREATE OR REPLACE FUNCTION public.tpo_college_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cid uuid := public.my_college_id();
  branches jsonb;
  trends   jsonb;
  seasons  jsonb;
begin
  if cid is null then
    return jsonb_build_object('error', 'Only a college can read this report.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'branch', b.branch, 'students', b.students,
           'active_week', b.active_week, 'in_squads', b.in_squads)
         order by b.students desc), '[]'::jsonb)
    into branches
    from (
      select coalesce(nullif(trim(p.branch), ''), 'Not set') as branch,
             count(*) as students,
             count(*) filter (where p.last_active > now() - interval '7 days') as active_week,
             count(*) filter (where exists (
               select 1 from public.squad_members m
                where m.student_id = p.id and m.left_at is null)) as in_squads
        from public.student_profiles p
       where p.college_id = cid
       group by 1
    ) b;
  -- Improving or declining, which is the last week's points minus the week
  -- before. Two numbers already existed; nothing had ever subtracted them.
  select coalesce(jsonb_agg(jsonb_build_object(
           'squad_id', t.squad_id, 'squad', t.name, 'week', t.week,
           'points', t.points, 'change', t.change)
         order by t.change desc nulls last), '[]'::jsonb)
    into trends
    from (
      select w.squad_id, s.name, w.week, w.points,
             (w.points - lag(w.points) over (partition by w.squad_id order by w.week)) as change,
             row_number() over (partition by w.squad_id order by w.week desc) as rn
        from public.squad_weekly_scores w
        join public.squads s on s.id = w.squad_id
       where s.college_id = cid and s.archived_at is null
    ) t
   where t.rn = 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'status', s.status,
           'is_current', s.is_current, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
           'completed_at', s.completed_at, 'created_at', s.created_at,
           'champion', c1.name, 'runner_up', c2.name, 'third', c3.name,
           'squads', (select count(*) from public.squads q where q.season_id = s.id),
           'year_group_label', coalesce(public.year_group_label(s.year_group), 'No year set'),
           'champions', (select coalesce(jsonb_agg(jsonb_build_object('bracket', br.bracket,
                              'champion', w1.name, 'runner_up', w2.name, 'third', w3.name,
                              'decided_by', coalesce(sc.decided_by,
                                (select m.decided_by from public.squad_matches m
                                  where m.season_id = s.id and m.stage = 'final' and m.cohort = br.bracket
                                    and public.match_winner(m.id) = sc.champion_squad_id
                                  order by m.scheduled_at desc limit 1))) order by br.bracket), '[]'::jsonb)
                           from (select distinct coalesce(q.bracket, q.cohort) as bracket from public.squads q
                                  where q.season_id = s.id and coalesce(q.bracket, q.cohort) is not null) br
                           left join public.season_champions sc on sc.season_id = s.id and sc.bracket = br.bracket
                           left join public.squads w1 on w1.id = sc.champion_squad_id
                           left join public.squads w2 on w2.id = sc.runner_up_squad_id
                           left join public.squads w3 on w3.id = sc.third_squad_id))
         order by s.starts_on desc, s.created_at desc), '[]'::jsonb)
    into seasons
    from public.seasons s
    left join public.squads c1 on c1.id = s.champion_squad_id
    left join public.squads c2 on c2.id = s.runner_up_squad_id
    left join public.squads c3 on c3.id = s.third_squad_id
   where s.college_id = cid
     and (s.status <> 'complete' or exists (select 1 from public.squads q where q.season_id = s.id));
  return jsonb_build_object('branches', branches, 'squad_trends', trends, 'seasons', seasons);
end $function$;

CREATE OR REPLACE FUNCTION public.tpo_students(_search text DEFAULT NULL::text, _branch text DEFAULT NULL::text, _batch text DEFAULT NULL::text, _squad text DEFAULT NULL::text, _status text DEFAULT NULL::text, _skill text DEFAULT NULL::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(student_id uuid, full_name text, roll_number text, branch text, batch text, email text, squad_id uuid, squad_name text, is_reserve boolean, days_quiet integer, total_xp integer, onboarding_status text, lots_done integer, attention text, gap_skills text[], total_count bigint, cohort text, cohort_waiting integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
  with mine as (select public.my_college_id() as cid),
  att as (select a.student_id, a.severity, a.reason_codes from public.tpo_attention() a),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch, p.batch, c.email, p.cohort,
           q.id as sq_id, q.name as sq_name, (m.id is null) as reserve,
           case when ls.last_try is null then 999
                else (current_date - (ls.last_try at time zone 'Asia/Kolkata')::date) end as quiet,
           p.total_xp, p.onboarding_status,
           coalesce(att.severity, 'ok') as attn, coalesce(att.reason_codes, '{}'::text[]) as codes,
           coalesce((select array_agg(s.skill order by s.skill)
                       from public.student_skills s
                      where s.student_id = p.id and s.status = 'needs_improvement'),
                    '{}'::text[]) as gaps
      from mine cross join public.student_profiles p
      left join public.student_contact c on c.student_id = p.id
      left join public.squad_members m on m.student_id = p.id and m.left_at is null
      left join public.squads q on q.id = m.squad_id
      left join att on att.student_id = p.id
      left join lateral (select max(s.created_at) as last_try from public.task_submissions s where s.student_id = p.id) ls on true
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
            or (_status = 'active_week'  and b.quiet <= 7) or (_status = 'missed_lots' and 'missed_lots' = any(b.codes)))
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
notify pgrst, 'reload schema';
commit;
