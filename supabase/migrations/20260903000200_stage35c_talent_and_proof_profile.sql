-- ============================================================================
-- Stage 35c — Talent search and the Proof Profile.
--
-- Both are SECURITY DEFINER so every guard lives here rather than being trusted
-- to whatever calls them: an unverified recruiter gets nothing, a
-- non-consenting student is absent at any filter setting, and email, phone and
-- roll number are simply not among the columns returned. A screen cannot leak a
-- column it never receives.
-- ============================================================================

create or replace function public.recruiter_talent(
  _role          text default null,
  _skills        text[] default null,
  _branch        text default null,
  _min_skill     integer default null,
  _min_comms     integer default null,
  _active_within integer default null,   -- days
  _limit         integer default 50,
  _offset        integer default 0
) returns table (
  student_id uuid, full_name text, branch text, batch text,
  target_role text, total_xp integer, trust_score numeric,
  skills_proven bigint, skills_total bigint, top_skills text[],
  lots_done bigint, proofs_verified bigint,
  comms_score integer, explanations bigint,
  days_since_active integer, active_weeks bigint,
  squad_name text, squad_rank integer, season_points integer,
  shortlisted boolean, total_matches bigint
) language sql stable security definer set search_path = public, pg_temp as $fn$
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
             where pu.student_id = c.id and pu.status in ('Verified','verified')) as proofs_verified,
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
$fn$;

-- The values a recruiter can actually filter by, drawn only from candidates
-- they are allowed to see. A dropdown offering skills nobody has is a dead end.
create or replace function public.recruiter_filters()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when not public.is_verified_recruiter()
              then jsonb_build_object('verified', false)
  else jsonb_build_object(
    'verified', true,
    'branches', (select coalesce(jsonb_agg(distinct p.branch order by p.branch), '[]'::jsonb)
                   from public.student_profiles p
                  where public.student_is_discoverable(p.id) and p.branch is not null),
    'roles',    (select coalesce(jsonb_agg(distinct p.target_role order by p.target_role), '[]'::jsonb)
                   from public.student_profiles p
                  where public.student_is_discoverable(p.id) and p.target_role is not null),
    'skills',   (select coalesce(jsonb_agg(x.skill order by x.skill), '[]'::jsonb) from (
                   select distinct s.skill from public.student_skills s
                    where public.student_is_discoverable(s.student_id)) x),
    'total',    (select count(*) from public.student_profiles p
                  where public.student_is_discoverable(p.id)))
  end;
$fn$;


-- ── the Proof Profile ───────────────────────────────────────────────────
-- The architecture insists that every score opens into the evidence under it,
-- so this returns the work alongside the numbers rather than a summary the
-- recruiter has to take on trust. Contact details come from here too, but only
-- once the student has accepted the shortlist.
create or replace function public.recruiter_proof_profile(_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare p record; rid uuid := public.my_recruiter_id(); accepted boolean;
begin
  if not public.is_verified_recruiter() then
    return jsonb_build_object('error', 'Your recruiter account is awaiting verification.');
  end if;

  if not public.student_is_discoverable(_student_id) then
    -- Deliberately the same answer as "no such student": whether a particular
    -- person is on this platform is itself something they did not consent to
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

    -- Consistency as weeks actually turned up, not a streak a single good
    -- fortnight can inflate.
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
end $fn$;

-- Logging a view is separate from reading a profile, so a failure to log can
-- never stop a recruiter working — and a student can see who has been looking.
create or replace function public.recruiter_log_view(_student_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare rid uuid := public.my_recruiter_id();
begin
  if rid is null or not public.is_verified_recruiter() then return; end if;
  if not public.student_is_discoverable(_student_id) then return; end if;
  insert into public.recruiter_views (recruiter_id, student_id)
  values (rid, _student_id);
end $fn$;

revoke all on function public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)
  from public, anon;
revoke all on function public.recruiter_filters()           from public, anon;
revoke all on function public.recruiter_proof_profile(uuid) from public, anon;
revoke all on function public.recruiter_log_view(uuid)      from public, anon;
grant execute on function public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)
  to authenticated;
grant execute on function public.recruiter_filters()           to authenticated;
grant execute on function public.recruiter_proof_profile(uuid) to authenticated;
grant execute on function public.recruiter_log_view(uuid)      to authenticated;
