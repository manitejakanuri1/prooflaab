-- Rollback of 180: tpo_students and tpo_insights as before (no section / waiting / draws).
begin;
drop function if exists public.tpo_students(text, text, text, text, text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.tpo_students(_search text DEFAULT NULL::text, _branch text DEFAULT NULL::text, _batch text DEFAULT NULL::text, _squad text DEFAULT NULL::text, _status text DEFAULT NULL::text, _skill text DEFAULT NULL::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(student_id uuid, full_name text, roll_number text, branch text, batch text, email text, squad_id uuid, squad_name text, is_reserve boolean, days_quiet integer, total_xp integer, onboarding_status text, lots_done integer, attention text, gap_skills text[], total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with mine as (select public.my_college_id() as cid),
  att as (select a.student_id, a.severity from public.tpo_attention() a),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch, p.batch, c.email,
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
         count(*) over () as total_count
    from filtered f
   order by f.full_name
   limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
$function$;
revoke all on function public.tpo_students(text, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.tpo_students(text, text, text, text, text, text, integer, integer) to authenticated, service_role;
CREATE OR REPLACE FUNCTION public.tpo_insights()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
        with mine as (select id, name, points, wins, losses
                        from public.squads where college_id = cid),
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
end $function$;
notify pgrst, 'reload schema';
commit;
