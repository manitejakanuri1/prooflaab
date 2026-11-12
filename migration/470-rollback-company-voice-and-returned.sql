-- Rollback of 470: restores 220-era recruiter_talent and recruiter_proof_profile
begin;

CREATE OR REPLACE FUNCTION public.recruiter_talent(_role text DEFAULT NULL::text, _skills text[] DEFAULT NULL::text[], _branch text DEFAULT NULL::text, _min_skill integer DEFAULT NULL::integer, _min_comms integer DEFAULT NULL::integer, _active_within integer DEFAULT NULL::integer, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(student_id uuid, full_name text, branch text, batch text, target_role text, total_xp integer, skills_proven bigint, skills_total bigint, top_skills text[], lots_done bigint, proofs_verified bigint, comms_score integer, explanations bigint, days_since_active integer, active_weeks bigint, squad_name text, squad_rank integer, season_points integer, shortlisted boolean, total_matches bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with me as (select public.my_recruiter_id() as rid,
                     public.is_verified_recruiter() as ok),
  candidates as (
    select p.id, p.full_name, p.branch, p.batch, p.target_role,
           p.total_xp, (select max(s.created_at) from public.task_submissions s where s.student_id = p.id) as last_active
      from public.student_profiles p
     where (select ok from me)
       and public.student_is_discoverable(p.id)
       and (_branch is null or lower(p.branch) = lower(_branch))
       and (_role   is null or p.target_role ilike '%' || _role || '%')
       and (_active_within is null
            or (select max(s.created_at) from public.task_submissions s where s.student_id = p.id) >= now() - make_interval(days => _active_within))
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
           (select count(distinct ts.task_id) from public.task_submissions ts
             where ts.student_id = c.id and ts.status = 'passed') as proofs_verified,
           (select round(avg(v.communication_score))::integer from public.voice_explanations v
             where v.student_id = c.id and v.communication_score is not null
               and v.transcript_source = 'server'
               and v.status = 'scored' and v.current_authoritative and v.withdrawn_at is null) as comms_score,
           (select count(*) from public.voice_explanations v
             where v.student_id = c.id and v.status = 'scored' and v.current_authoritative and v.withdrawn_at is null) as explanations,
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
     where (_min_skill is null or e.best_skill_score >= _min_skill)
       and (_min_comms is null or e.comms_score >= _min_comms)
       and (_skills is null or _skills <@ e.top_skills)
  )
  select f.id as student_id, f.full_name, f.branch, f.batch, f.target_role,
         f.total_xp, f.skills_proven, f.skills_total, f.top_skills, f.lots_done,
         f.proofs_verified, f.comms_score, f.explanations,
         coalesce((current_date - (f.last_active at time zone 'Asia/Kolkata')::date), 999) as days_since_active,
         f.active_weeks, f.squad_name, f.squad_rank, f.season_points, f.shortlisted,
         count(*) over () as total_matches
    from filtered f
   order by f.shortlisted desc, f.proofs_verified desc, f.total_xp desc nulls last, f.id
   limit coalesce(_limit, 50) offset coalesce(_offset, 0);
$function$;

CREATE OR REPLACE FUNCTION public.recruiter_proof_profile(_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p record; rid uuid := public.my_recruiter_id(); accepted boolean;
begin
  if not public.is_verified_recruiter() then
    return jsonb_build_object('error', 'Your recruiter account is awaiting verification.');
  end if;
  if not public.student_is_discoverable(_student_id) then
    return jsonb_build_object('error', 'No candidate found.');
  end if;
  select * into p from public.student_profiles where id = _student_id;
  select sl.student_response = 'accepted' into accepted
    from public.recruiter_shortlists sl
   where sl.recruiter_id = rid and sl.student_id = _student_id;
  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'branch', p.branch,
    'batch', p.batch,
    'year_of_study', p.year_of_study,
    'target_role', p.target_role,
    'secondary_roles', p.secondary_roles,
    'work_preference', p.work_preference,
    'preferred_locations', p.preferred_locations,
    'open_to_relocate', p.open_to_relocate,
    'total_xp', p.total_xp,
    'last_active', (select max(s.created_at) from public.task_submissions s where s.student_id = p.id),
    'days_since_active', coalesce((current_date - ((select max(s.created_at) from public.task_submissions s where s.student_id = p.id) at time zone 'Asia/Kolkata')::date), 999),
    'contact_unlocked', coalesce(accepted, false),
    'contact', case when coalesce(accepted, false) then
        (select jsonb_build_object('email', c.email, 'phone', c.phone,
                                   'github', c.github_url, 'linkedin', c.linkedin_url)
           from public.student_contact c where c.student_id = p.id)
      else null end,
    'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                 'skill', s.skill, 'status', s.status, 'score', s.assessed_score,
                 'lots', s.proven_lots, 'explanations', s.proven_voice,
                 'last_evidence_at', s.last_evidence_at)
                 order by array_position(array['proven','assessed','claimed','needs_improvement'],
                                         s.status), s.skill), '[]'::jsonb)
                 from public.student_skills s
                where s.student_id = p.id and s.status is distinct from 'needs_improvement'),
    'certifications', (select coalesce(jsonb_agg(jsonb_build_object(
                         'name', t.name, 'issuer', t.issuer, 'issued_on', t.issued_on,
                         'url', t.credential_url, 'source', t.source)
                         order by t.issued_on desc nulls last), '[]'::jsonb)
                         from public.student_certifications t where t.student_id = p.id),
    'scorecard', (select jsonb_build_object(
                    'resume_quality', s.resume_quality_score,
                    'ats_match', s.ats_match_score,
                    'skill_proof', s.skill_proof_score,
                    'project_proof', s.project_proof_score,
                    'reasoning', s.reasoning_score,
                    'coding', s.coding_score,
                    'interview_readiness', s.interview_readiness_score,
                    'at', s.created_at)
                    from public.resume_scorecards s
                   where s.student_id = p.id order by s.created_at desc limit 1),
    'work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select s.id, 'Verified'::text as status, s.sandbox_score as ai_score, s.created_at as submitted_at,
               t.title, t.difficulty,
               case when t.sandbox_config_id is not null then 'code' else 'written' end as kind,
               (select ve.communication_score from public.voice_explanations ve
                 where ve.task_id = s.task_id and ve.student_id = s.student_id
                   and ve.transcript_source = 'server' and ve.status = 'scored'
                   and ve.current_authoritative and ve.withdrawn_at is null
                 order by ve.created_at desc limit 1) as voice_score
          from public.task_submissions s
          join public.tasks t on t.id = s.task_id
         where s.student_id = p.id and s.status = 'passed' and t.source = 'daily_lot'
           and s.created_at = (select max(l.created_at) from public.task_submissions l
                                where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
         order by s.created_at desc limit 10) w),
    'explanations', (select coalesce(jsonb_agg(v order by v.created_at desc), '[]'::jsonb) from (
        select ve.id, ve.duration_seconds, ve.communication_score,
               ve.created_at, (ve.withdrawn_at is null and ve.storage_path is not null) as audio_shared,
               ve.transcript,
               (select t.title from public.tasks t where t.id = ve.task_id) as about
          from public.voice_explanations ve
         where ve.student_id = p.id and ve.communication_score >= 50
           and exists (select 1 from public.tasks dl where dl.id = ve.task_id and dl.source = 'daily_lot')
           and ve.transcript_source = 'server'
           and ve.status = 'scored' and ve.current_authoritative and ve.withdrawn_at is null
         order by ve.created_at desc limit 5) v),
    'answers', public.student_work(p.id),
    'communication', (select round(avg(v.communication_score))::integer
                        from public.voice_explanations v
                       where v.student_id = p.id and v.communication_score is not null
                         and exists (select 1 from public.tasks dl where dl.id = v.task_id and dl.source = 'daily_lot')
                         and v.transcript_source = 'server'
                         and v.status = 'scored' and v.current_authoritative and v.withdrawn_at is null),
    'consistency', jsonb_build_object(
      'active_weeks', (select count(*) from public.student_weekly_scores w
                        where w.student_id = p.id and w.points > 0),
      'weeks_total',  (select count(distinct w.week) from public.student_weekly_scores w
                        where w.student_id = p.id),
      'current_streak', (select current_days from public.student_streaks st
                          where st.student_id = p.id),
      'lots_done', (select count(*) from public.tasks t
                     where t.student_id = p.id and t.status in ('Completed','completed'))),
    'squad', (select jsonb_build_object(
                'name', q.name, 'rank', q.rank, 'points', q.points,
                'record', concat_ws('-', q.wins, q.draws, q.losses))
                from public.squad_members m
                join public.squads q on q.id = m.squad_id
               where m.student_id = p.id and m.left_at is null limit 1)
  );
end;
$function$;

notify pgrst, 'reload schema';
commit;
