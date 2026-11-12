-- Rollback for migration 220: the three function definitions as they were on TEST before it.
begin;
CREATE OR REPLACE FUNCTION public.tpo_student_profile(_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cid uuid := public.my_college_id();
  me  uuid := (select auth.uid());
  p record;
  may_see boolean;
  intake record;    -- student_intake: welcome seen, onboarding finished
  claim record;     -- latest resume (resume path)
  pick record;      -- latest interests (skip path)
  test record;      -- first skills test (not a retest)
  card record;      -- first score card
  first_login timestamptz;
  first_pass timestamptz;
  test_avg numeric;
  coding_done int;
  coding_solved int;
  coding_total int;
  finished boolean;  -- test graded, score card made, coding round done (or the test had none)
begin
  select * into p from public.student_profiles where id = _student_id;
  if p is null then return jsonb_build_object('error','no such student'); end if;
  may_see :=
       (cid is not null and p.college_id is not null and p.college_id = cid)
    or coalesce(public.is_admin(), false)
    or (me is not null and p.id = me);
  if not coalesce(may_see, false) then
    return jsonb_build_object('error','that student is not at your college');
  end if;
  -- Onboarding, read from the rows each step really writes (121). The old columns
  -- profile_completed / calibration_completed / first_task_completed belonged to the
  -- retired proof flow and nothing sets them any more, so every tick stayed empty.
  select * into intake from public.student_intake where user_id = p.id;
  select * into claim from public.resume_claims where student_id = p.id order by created_at desc limit 1;
  select * into pick from public.student_interests where student_id = p.id order by created_at desc limit 1;
  select * into test from public.resume_assessments
   where student_id = p.id and not coalesce(is_retest, false) order by created_at limit 1;
  select * into card from public.resume_scorecards
   where student_id = p.id and not coalesce(is_retest, false) order by created_at limit 1;
  select min(occurred_at) into first_login from public.student_activity_events
   where student_id = p.id and event_type = 'login';
  select min(created_at) into first_pass from public.task_submissions
   where student_id = p.id and status = 'passed';
  if test.id is not null then
    if jsonb_typeof(test.answer_scores) = 'array' then
      select round(avg((x->>'final_score')::numeric)) into test_avg
        from jsonb_array_elements(test.answer_scores) x where x ? 'final_score';
    end if;
    if jsonb_typeof(test.coding_questions) = 'array' then
      coding_total := jsonb_array_length(test.coding_questions);
    end if;
    if jsonb_typeof(test.coding_results) = 'object' then
      select count(*), count(*) filter (where coalesce((
               select bool_and((r->>'passed')::boolean) from jsonb_array_elements(
                 case when jsonb_typeof(e.value->'results') = 'array' then e.value->'results' else '[]'::jsonb end) r), false))
        into coding_done, coding_solved
        from jsonb_each(test.coding_results) e;
    end if;
  end if;
  finished := coalesce(test.status = 'graded', false) and card.id is not null
              and (coalesce(coding_done, 0) > 0 or coalesce(coding_total, 0) = 0);
  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'roll_number', p.roll_number,
    'branch', p.branch,
    'batch', p.batch,
    'email', (select c.email from public.student_contact c where c.student_id = p.id),
    'phone', (select c.phone from public.student_contact c where c.student_id = p.id),
    'total_xp', p.total_xp,
    'joined_at', p.created_at,
    'last_active', p.last_active,
    'days_quiet', case when p.last_active is null then 999
                       else (current_date - p.last_active::date) end,
    'onboarding', jsonb_build_object(
      'status', p.onboarding_status,
      'profile_completed', claim.status = 'confirmed' or claim.confirmed_at is not null or pick.confirmed_at is not null,
      'calibration_completed', coalesce(finished, false),
      'first_task_completed', first_pass is not null,
      'invited_at', p.invited_at,
      'onboarded_at', coalesce(case when finished then greatest(test.updated_at, card.created_at) end, p.onboarded_at)),
    -- The seven onboarding steps, in order, for the college and admin profile.
    'onboarding_steps', jsonb_build_array(
      jsonb_build_object('step', 'Added by college', 'done', true,
        'at', coalesce(p.invited_at, p.created_at), 'detail', null),
      jsonb_build_object('step', 'Signed in', 'done', first_login is not null or coalesce(intake.has_seen_welcome, false),
        'at', least(first_login, intake.welcome_seen_at), 'detail', null),
      -- The Skip path also writes a resume_claims row: no file, storage_path 'interests:<student>',
      -- the picked skills in claims.skills.
      case when claim.id is not null and claim.storage_path not like 'interests:%' then
        jsonb_build_object('step', 'Resume uploaded', 'done', true, 'at', claim.created_at,
          'detail', concat_ws(' · ', 'resume score ' || claim.resume_quality_score, 'ATS ' || claim.ats_match_score,
                              case when claim.status <> 'confirmed' and claim.confirmed_at is null then 'not confirmed yet' end))
      when claim.id is not null then
        jsonb_build_object('step', 'Interests picked (no resume)', 'done', true, 'at', claim.created_at,
          'detail', concat_ws(' · ', claim.target_role, array_to_string(claim.skills, ', ')))
      when pick.id is not null then
        jsonb_build_object('step', 'Interests picked (no resume)', 'done', true, 'at', pick.created_at,
          'detail', array_to_string(pick.interests, ', '))
      else jsonb_build_object('step', 'Resume or interests', 'done', false, 'at', null, 'detail', null) end,
      jsonb_build_object('step', 'Skills test', 'done', coalesce(test.status = 'graded', false),
        'at', case when test.status = 'graded' then test.updated_at else test.started_at end,
        'detail', case when test.id is null then null
                       when test.status = 'graded' then concat_ws(' · ',
                         jsonb_array_length(case when jsonb_typeof(test.questions) = 'array' then test.questions else '[]'::jsonb end) || ' questions',
                         'average ' || test_avg || '%')
                       else 'started, not finished' end),
      -- The questions are graded (and a score card made) before the coding round opens, so a
      -- student who leaves at the coding round has a graded test but no coding results.
      jsonb_build_object('step', 'Coding round', 'done', coalesce(coding_done, 0) > 0,
        'at', null,
        'detail', case when coalesce(coding_done, 0) > 0 then coding_solved || ' of ' || coalesce(coding_total, coding_done) || ' solved'
                       when test.status = 'graded' and coalesce(coding_total, 0) > 0 then 'not finished: left before the coding round ended'
                       when test.status = 'graded' then 'none in this test' end),
      jsonb_build_object('step', 'Score card', 'done', card.id is not null, 'at', card.created_at,
        'detail', case when card.id is not null then 'readiness ' || card.interview_readiness_score || '/100' end),
      -- student_intake.intake_completed_at is set when the resume is uploaded or Skip is chosen,
      -- before the test, so "complete" means: the test is graded and its score card exists.
      jsonb_build_object('step', 'Onboarding complete', 'done', finished,
        'at', case when finished then greatest(test.updated_at, card.created_at) end,
        'detail', null)),
    'squad', (select jsonb_build_object(
                'id', q.id, 'name', q.name, 'role', m.membership_type,
                'contribution', m.contribution, 'joined_at', m.joined_at,
                'points', q.points, 'rank', q.rank,
                'wins', q.wins, 'draws', q.draws, 'losses', q.losses,
                'my_season_points', (select coalesce(sum(w.points), 0) from public.student_weekly_scores w
                                      where w.student_id = p.id and w.season_id = q.season_id))
                from public.squad_members m
                join public.squads q on q.id = m.squad_id
               where m.student_id = p.id and m.left_at is null limit 1),
    'activity_30d', (select coalesce(jsonb_agg(t order by t.n desc), '[]'::jsonb) from (
        select event_type, count(*) as n
          from public.student_activity_events
         where student_id = p.id and occurred_at >= now() - interval '30 days'
         group by event_type) t),
    'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                 'skill', s.skill, 'status', s.status,
                 'score', s.assessed_score, 'lots', s.proven_lots)
                 order by s.status, s.skill), '[]'::jsonb)
                 from public.student_skills s where s.student_id = p.id),
    'tasks', jsonb_build_object(
      -- assigned = Lots written for this student; completed = distinct Lots passed.
      'assigned',  (select count(*) from public.tasks where student_id = p.id),
      'completed', (select count(distinct task_id) from public.task_submissions
                     where student_id = p.id and status = 'passed'),
      'auto_graded_passed', (select count(*) from public.task_submissions
                               where student_id = p.id and status = 'passed'),
      'attempts', (select count(*) from public.task_submissions where student_id = p.id),
      'failed_attempts', (select count(*) from public.task_submissions
                           where student_id = p.id and status = 'failed')),
    'streak', (select jsonb_build_object('current', k.current_days, 'longest', k.longest_days,
                                         'last_active_on', k.last_active_on)
                 from public.student_streaks k where k.student_id = p.id),
    'voice', (select jsonb_build_object('count', count(*),
                                        'scored', count(v.communication_score),
                                        'average_score', round(avg(v.communication_score)),
                                        'last_score', (array_agg(v.communication_score order by v.created_at desc)
                                                         filter (where v.communication_score is not null))[1])
                from public.voice_explanations v where v.student_id = p.id),
    'mock_interviews', (select jsonb_build_object('count', count(*),
                                                  'completed', count(*) filter (where mi.status = 'completed'),
                                                  'last_score', (array_agg(mi.overall_score order by mi.created_at desc)
                                                                   filter (where mi.overall_score is not null))[1],
                                                  'last_at', max(mi.created_at))
                          from public.mock_interviews mi where mi.student_id = p.id),
    'voice_recordings', (select count(*) from public.voice_explanations where student_id = p.id),
    -- Latest attempt per Lot (task_submissions).
    'recent_work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select * from (
          select distinct on (s.task_id) s.id, null::text as file_name, s.status,
                 s.sandbox_score as ai_score, s.created_at as submitted_at,
                 (select count(*) from public.task_submissions x
                   where x.student_id = p.id and x.task_id = s.task_id) as attempts,
                 (select t.title from public.tasks t where t.id = s.task_id) as task_title
            from public.task_submissions s
           where s.student_id = p.id
           order by s.task_id, s.created_at desc) latest
         order by latest.submitted_at desc limit 5) w),
    'interventions', (select coalesce(jsonb_agg(jsonb_build_object(
                        'type', i.type, 'reason', i.reason, 'created_at', i.created_at)
                        order by i.created_at desc), '[]'::jsonb)
                        from public.interventions i where i.student_id = p.id)
  );
end
$function$
;

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
$function$
;

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
    -- Only the authoritative, server-transcribed, scored explanation of a submission
    -- (migration 61) is ever shown to a company. This replaces the on-hold migration 46.
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
    -- 168: with the one switch on, a company sees all finished work: the answer and the voice words (never weak areas).
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
;
commit;
notify pgrst, 'reload schema';
