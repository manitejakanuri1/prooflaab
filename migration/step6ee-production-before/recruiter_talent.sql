CREATE OR REPLACE FUNCTION public.recruiter_talent(_role text DEFAULT NULL::text, _skills text[] DEFAULT NULL::text[], _branch text DEFAULT NULL::text, _min_skill integer DEFAULT NULL::integer, _min_comms integer DEFAULT NULL::integer, _active_within integer DEFAULT NULL::integer, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(student_id uuid, full_name text, branch text, batch text, target_role text, total_xp integer, trust_score numeric, skills_proven bigint, skills_total bigint, top_skills text[], lots_done bigint, proofs_verified bigint, comms_score integer, explanations bigint, days_since_active integer, active_weeks bigint, squad_name text, squad_rank integer, season_points integer, shortlisted boolean, total_matches bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with me as (select public.my_recruiter_id() as rid,
                     public.is_verified_recruiter() as ok),
  candidates as (
    select p.id, p.full_name, p.branch, p.batch, p.target_role,
           p.total_xp, p.trust_score, p.last_active
      from public.student_profiles p
     where (select ok from me)
       and public.student_is_discoverable(p.id)
       and (_branch is null or lower(p.branch) = lower(_branch))
       and (_role   is null or p.target_role ilike '%' || _role || '%')
       and (_active_within is null
            or (p.last_active is not null
                and p.last_active >= now() - make_interval(days => _active_within)))
  ),
  enriched as (
    select c.*,
           (select count(*) from public.student_skills s
             where s.student_id = c.id and s.status = 'proven') as skills_proven,
           (select count(*) from public.student_skills s
             where s.student_id = c.id) as skills_total,
           (select coalesce(array_agg(s.skill order by
                      array_position(array['proven','assessed','claimed'], s.status), s.skill),
                    '{}')
              from public.student_skills s where s.student_id = c.id) as top_skills,
           (select max(s.assessed_score) from public.student_skills s
             where s.student_id = c.id) as best_skill_score,
           (select count(*) from public.tasks t
             where t.student_id = c.id and t.status in ('Completed','completed')) as lots_done,
           (select count(*) from public.proof_uploads pu
             where pu.student_id = c.id and pu.status in ('Verified','verified'))
           + (select count(*) from public.task_submissions ts
             where ts.student_id = c.id and ts.status = 'passed') as proofs_verified,
           (select round(avg(v.communication_score))::integer from public.voice_explanations v
             where v.student_id = c.id and v.communication_score is not null) as comms_score,
           (select count(*) from public.voice_explanations v
             where v.student_id = c.id) as explanations,
           (select count(distinct w.week) from public.student_weekly_scores w
             where w.student_id = c.id and w.points > 0) as active_weeks,
           (select q.name from public.squad_members m
              join public.squads q on q.id = m.squad_id
             where m.student_id = c.id and m.left_at is null limit 1) as squad_name,
           (select q.rank from public.squad_members m
              join public.squads q on q.id = m.squad_id
             where m.student_id = c.id and m.left_at is null limit 1) as squad_rank,
           (select q.points from public.squad_members m
              join public.squads q on q.id = m.squad_id
             where m.student_id = c.id and m.left_at is null limit 1) as season_points,
           exists (select 1 from public.recruiter_shortlists sl
                    where sl.student_id = c.id
                      and sl.recruiter_id = (select rid from me)) as shortlisted
      from candidates c
  ),
  filtered as (
    select * from enriched e
     where (_min_skill is null or coalesce(e.best_skill_score, 0) >= _min_skill)
       and (_min_comms is null or coalesce(e.comms_score, 0)     >= _min_comms)
       and (_skills is null or exists (
              select 1 from public.student_skills s
               where s.student_id = e.id
                 and lower(s.skill) = any (select lower(x) from unnest(_skills) x)))
  )
  select f.id, f.full_name, f.branch, f.batch, f.target_role,
         f.total_xp, f.trust_score,
         f.skills_proven, f.skills_total, f.top_skills,
         f.lots_done, f.proofs_verified,
         f.comms_score, f.explanations,
         case when f.last_active is null then 999
              else (current_date - f.last_active::date) end,
         f.active_weeks,
         f.squad_name, f.squad_rank, f.season_points,
         f.shortlisted,
         count(*) over ()
    from filtered f
   order by f.skills_proven desc, f.proofs_verified desc, f.total_xp desc
   limit greatest(1, least(coalesce(_limit, 50), 100))
  offset greatest(0, coalesce(_offset, 0));
$function$
