-- 122: the college and the admin see a student's failed attempts, streak, squad points,
-- voice scores and mock interviews in the student profile.
--
-- Visibility audit, staging, 19 Oct 2026: a failed Lot attempt was visible to the admin
-- (Submissions) but not to the college; the streak, the mock interview and the voice score
-- were visible to neither; the admin had no squad points at all. The profile pop-up is the
-- same for both (121), so 122 adds to tpo_student_profile:
--   tasks.attempts / tasks.failed_attempts, recent_work[].attempts,
--   streak {current, longest, last_active_on},
--   voice {count, scored, average_score, last_score},
--   mock_interviews {count, completed, last_score, last_at},
--   squad.points / rank / wins / draws / losses / my_season_points.
-- Every existing key stays. Who may call it is unchanged.
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
$function$;

-- Self-check: the new keys come back for a college's own student; another college sees nothing.
do $$
declare sid uuid; tpo uuid; other uuid; r jsonb;
begin
  select s.id, c.user_id into sid, tpo from public.student_profiles s join public.colleges c on c.id = s.college_id
   where c.verification_status = 'approved' limit 1;
  if sid is null then raise notice '122 self-check skipped: no college student'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', tpo, 'role', 'authenticated')::text, true);
  r := public.tpo_student_profile(sid);
  if not (r ? 'streak' and r ? 'voice' and r ? 'mock_interviews' and r->'tasks' ? 'failed_attempts') then
    raise exception '122 self-check: new keys missing: %', r;
  end if;
  select c.user_id into other from public.colleges c
   where c.verification_status = 'approved' and c.id <> (select college_id from public.student_profiles where id = sid) limit 1;
  if other is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
    if public.tpo_student_profile(sid) ? 'streak' then
      raise exception '122 self-check: another college could read the profile';
    end if;
  end if;
  perform set_config('request.jwt.claims', '', true);
  raise notice '122 self-check passed';
end $$;

commit;
notify pgrst, 'reload schema';
