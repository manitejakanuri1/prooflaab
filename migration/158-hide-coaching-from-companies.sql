-- 158 (MF-022): companies and signed-out visitors no longer receive a student's coaching or weak points.
--   recruiter_proof_profile (company Talent > proof profile):
--     - voice explanations: no coaching notes (communication_notes), and only explanations scored 50 or more
--     - skills: rows marked needs_improvement are left out
--     - scorecard: the skill_gap list (missing / needs improvement) is left out
--   portfolio_work (public /portfolio/<slug> and the student's own portfolio): the voice score is shown only
--     when it is 50 or more; the passed Lot itself is still listed.
-- The student still sees all of it on their own screens (those read their own tables, not these functions).
-- public_resume_scorecards (roadmap, skill_gap) is security_invoker, so only the student and admins can read it;
-- not changed.
-- Rollback: migration/158-rollback-hide-coaching-from-companies.sql
begin;

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
    'last_active', p.last_active,
    'days_since_active', case when p.last_active is null then 999
                              else (current_date - p.last_active::date) end,
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
    -- Lots this student passed (latest passing attempt per Lot). Status and score only - no code.
    'work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select s.id, 'Verified'::text as status, s.sandbox_score as ai_score, s.created_at as submitted_at,
               t.title, t.difficulty
          from public.task_submissions s
          join public.tasks t on t.id = s.task_id
         where s.student_id = p.id and s.status = 'passed' and t.source = 'daily_lot'
           and s.created_at = (select max(l.created_at) from public.task_submissions l
                                where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
         order by s.created_at desc limit 10) w),
    -- Only the authoritative, server-transcribed, scored explanation of a submission
    -- (migration 61) is ever shown to a company. This replaces the on-hold migration 46.
    'explanations', (select coalesce(jsonb_agg(v order by v.created_at desc), '[]'::jsonb) from (
        select ve.id, ve.duration_seconds, ve.communication_score,
               ve.created_at, (p.share_voice_audio and ve.withdrawn_at is null and ve.storage_path is not null) as audio_shared,
               (select t.title from public.tasks t where t.id = ve.task_id) as about
          from public.voice_explanations ve
         where ve.student_id = p.id and ve.communication_score >= 50
           and exists (select 1 from public.tasks dl where dl.id = ve.task_id and dl.source = 'daily_lot')
           and ve.transcript_source = 'server'
           and ve.status = 'scored' and ve.current_authoritative and ve.withdrawn_at is null
         order by ve.created_at desc limit 5) v),
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
                'record', q.wins || '-' || q.draws || '-' || q.losses,
                'contribution', m.contribution)
                from public.squad_members m
                join public.squads q on q.id = m.squad_id
               where m.student_id = p.id and m.left_at is null limit 1),
    'ladder', jsonb_build_object(
      'track', (select t.track_slug from public.student_tracks t
                 where t.student_id = p.id order by t.created_at desc limit 1),
      'cleared', (select count(*) from public.student_levels sl
                   where sl.student_id = p.id and sl.status in ('cleared','mastered'))),
    'shortlist', (select jsonb_build_object('stage', sl.stage,
                          'response', sl.student_response, 'note', sl.note)
                    from public.recruiter_shortlists sl
                   where sl.recruiter_id = rid and sl.student_id = p.id)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.portfolio_work(_student_id uuid)
 RETURNS TABLE(task_id uuid, title text, category text, kind text, language text, score integer, passed_count integer, total_count integer, passed_at timestamp with time zone, explanation_score integer, set_by text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select t.id, t.title, coalesce(t.lot_category, t.category),
         case when s.sandbox_config_id is not null then 'code' else 'written' end,
         s.language, s.sandbox_score, s.passed_count, s.total_count, s.created_at,
         (select v.communication_score from public.voice_explanations v
           where v.submission_id = s.id and v.status = 'scored' and v.withdrawn_at is null and v.communication_score >= 50
           order by v.current_authoritative desc, v.created_at desc limit 1),
         (select st.name from public.startups st where st.user_id = t.sponsored_by)
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
   where s.student_id = _student_id
     and s.status = 'passed'
     and s.created_at = (select max(l.created_at) from public.task_submissions l
                          where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
     and (
          _student_id = (select auth.uid())
       or coalesce((select public.is_admin()), false)
       or exists (select 1 from public.student_portfolios p
                   where p.student_id = _student_id and p.is_public)
     )
   order by s.created_at desc
   limit 100;
$function$;

do $$
declare body text;
begin
  body := pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure);
  if body ~ 'communication_notes|skill_gap' then raise exception '158: company profile still sends coaching data'; end if;
  if body !~ 'is distinct from ''needs_improvement''' then raise exception '158: weak skills still sent'; end if;
  if pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure) !~ 'communication_score >= 50' then
    raise exception '158: portfolio still sends low voice scores';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
