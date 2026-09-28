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
    -- Deliberately the same answer as "no such student": whether a particular
    -- person is on the platform is itself something they did not consent to
    -- share.
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
    'trust_score', p.trust_score,
    'last_active', p.last_active,
    'days_since_active', case when p.last_active is null then 999
                              else (current_date - p.last_active::date) end,

    -- Contact details are the one thing a shortlist buys, and only if the
    -- student said yes.
    'contact_unlocked', coalesce(accepted, false),
    'contact', case when coalesce(accepted, false) then
        (select jsonb_build_object('email', c.email, 'phone', c.phone,
                                   'github', c.github_url, 'linkedin', c.linkedin_url)
           from public.student_contact c where c.student_id = p.id)
      else null end,

    -- Skills, each with what earned the status rather than only the label.
    'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                 'skill', s.skill, 'status', s.status, 'score', s.assessed_score,
                 'lots', s.proven_lots, 'explanations', s.proven_voice,
                 'last_evidence_at', s.last_evidence_at)
                 order by array_position(array['proven','assessed','claimed','needs_improvement'],
                                         s.status), s.skill), '[]'::jsonb)
                 from public.student_skills s where s.student_id = p.id),

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
                    'skill_gap', s.skill_gap,
                    'at', s.created_at)
                    from public.resume_scorecards s
                   where s.student_id = p.id order by s.created_at desc limit 1),

    -- The work itself, which is what a score is a summary of.
    'work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select pu.id, pu.status, pu.ai_score, pu.submitted_at,
               (select t.title from public.tasks t where t.id = pu.task_id) as title,
               (select t.difficulty from public.tasks t where t.id = pu.task_id) as difficulty
          from public.proof_uploads pu
         where pu.student_id = p.id and pu.is_public = true
         order by pu.submitted_at desc nulls last limit 10) w),

    'explanations', (select coalesce(jsonb_agg(v order by v.created_at desc), '[]'::jsonb) from (
        select ve.id, ve.duration_seconds, ve.communication_score,
               ve.communication_notes, ve.created_at,
               (select t.title from public.tasks t where t.id = ve.task_id) as about
          from public.voice_explanations ve
         where ve.student_id = p.id and ve.communication_score is not null
         order by ve.created_at desc limit 5) v),

    'communication', (select round(avg(v.communication_score))::integer
                        from public.voice_explanations v
                       where v.student_id = p.id and v.communication_score is not null),

    -- Consistency: how many weeks they actually turned up, not a streak number
    -- that a single good fortnight can inflate.
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
end $function$
