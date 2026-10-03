-- 64: the company-facing functions use current evidence only (Wave 8c).
--   recruiter_home          - "Lots submitted" counts task_submissions (no proof_uploads).
--   recruiter_proof_profile - no trust_score; "work" = Lots passed (status and score, no code);
--                             explanations and the communication average use only the
--                             authoritative, server-transcribed, scored recording (migration 61).
--   recruiter_talent        - no trust_score column; "verified" = distinct Lots passed;
--                             comms score and count from authoritative recordings only.
-- This supersedes migration 46 (on hold since Step 6EE): its purpose - a company must never
-- see or filter on a self-reported transcript - is met here on top of the stage69 behaviour
-- (passed submissions count). 46 must not be applied anywhere.
-- PRODUCTION NOTE: these bodies were derived from STAGING. Before applying to production,
-- capture the production bodies (they differ) for the rollback file.
begin;

drop function if exists public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.recruiter_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare rid uuid := public.my_recruiter_id(); me record;
begin
  if rid is null then return jsonb_build_object('error', 'not a recruiter'); end if;
  select * into me from public.recruiters where id = rid;
  if not me.verified then
    return jsonb_build_object(
      'verified', false,
      'company', me.company,
      'message', 'Your account is awaiting verification. Candidates appear once ' ||
                 'an administrator has approved you.');
  end if;
  return jsonb_build_object(
    'verified', true,
    'company', me.company,
    'candidates_available', (select count(*) from public.student_profiles p
                              where public.student_is_discoverable(p.id)),
    'new_this_week', (select count(*) from public.student_profiles p
                       where public.student_is_discoverable(p.id)
                         and p.created_at >= now() - interval '7 days'),
    'shortlisted', (select count(*) from public.recruiter_shortlists
                     where recruiter_id = rid),
    'awaiting_response', (select count(*) from public.recruiter_shortlists
                           where recruiter_id = rid and student_response is null),
    'accepted', (select count(*) from public.recruiter_shortlists
                  where recruiter_id = rid and student_response = 'accepted'),
    'lots_open', (select count(*) from public.tasks t
                   where t.sponsored_by = rid and t.status = 'pending'),
    'lots_submitted', (select count(*) from public.tasks t
                        where t.sponsored_by = rid
                          and exists (select 1 from public.task_submissions ts where ts.task_id = t.id)),
    'pipeline', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
        select stage, count(*) as n from public.recruiter_shortlists
         where recruiter_id = rid group by stage) s),
    'recommended', (select coalesce(jsonb_agg(r order by r.skills_proven desc), '[]'::jsonb) from (
        select t.student_id, t.full_name, t.branch, t.target_role,
               t.skills_proven, t.proofs_verified, t.comms_score, t.days_since_active
          from public.recruiter_talent(null, null, null, null, null, 30, 5, 0) t
         where not t.shortlisted) r),
    'recent_views', (select coalesce(jsonb_agg(v order by v.viewed_at desc), '[]'::jsonb) from (
        select rv.student_id, p.full_name, rv.viewed_at
          from public.recruiter_views rv
          join public.student_profiles p on p.id = rv.student_id
         where rv.recruiter_id = rid
         order by rv.viewed_at desc limit 8) v)
  );
end
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
    -- Lots this student passed (latest passing attempt per Lot). Status and score only - no code.
    'work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select s.id, 'Verified'::text as status, s.sandbox_score as ai_score, s.created_at as submitted_at,
               t.title, t.difficulty
          from public.task_submissions s
          join public.tasks t on t.id = s.task_id
         where s.student_id = p.id and s.status = 'passed'
           and s.created_at = (select max(l.created_at) from public.task_submissions l
                                where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
         order by s.created_at desc limit 10) w),
    -- Only the authoritative, server-transcribed, scored explanation of a submission
    -- (migration 61) is ever shown to a company. This replaces the on-hold migration 46.
    'explanations', (select coalesce(jsonb_agg(v order by v.created_at desc), '[]'::jsonb) from (
        select ve.id, ve.duration_seconds, ve.communication_score,
               ve.communication_notes, ve.created_at,
               (select t.title from public.tasks t where t.id = ve.task_id) as about
          from public.voice_explanations ve
         where ve.student_id = p.id and ve.communication_score is not null
           and ve.transcript_source = 'server'
           and ve.status = 'scored' and ve.current_authoritative and ve.withdrawn_at is null
         order by ve.created_at desc limit 5) v),
    'communication', (select round(avg(v.communication_score))::integer
                        from public.voice_explanations v
                       where v.student_id = p.id and v.communication_score is not null
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
           p.total_xp, p.last_active
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
           -- "verified" = distinct Lots passed (task_submissions).
           (select count(distinct ts.task_id) from public.task_submissions ts
             where ts.student_id = c.id and ts.status = 'passed') as proofs_verified,
           -- Only authoritative, server-transcribed, scored explanations (migration 61)
           -- count toward what a company sees and filters on.
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
     where (_min_skill is null or coalesce(e.best_skill_score, 0) >= _min_skill)
       and (_min_comms is null or coalesce(e.comms_score, 0)     >= _min_comms)
       and (_skills is null or exists (
              select 1 from public.student_skills s
               where s.student_id = e.id
                 and lower(s.skill) = any (select lower(x) from unnest(_skills) x)))
  )
  select f.id, f.full_name, f.branch, f.batch, f.target_role,
         f.total_xp,
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
$function$;

revoke all on function public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer) to authenticated, service_role;

do $$
declare f text;
begin
  foreach f in array array['public.recruiter_home()', 'public.recruiter_proof_profile(uuid)', 'public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)']
  loop
    if pg_get_functiondef(f::regprocedure) ~ 'trust_score|proof_uploads' then
      raise exception '64 self-check: % still reads a retired source', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)', 'execute') then
    raise exception '64 self-check: anon can execute recruiter_talent';
  end if;
  if not has_function_privilege('authenticated', 'public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)', 'execute') then
    raise exception '64 self-check: signed-in users lost recruiter_talent';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
