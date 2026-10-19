-- Rollback of 121: tpo_student_profile as it was on staging before 121 (onboarding ticks read the old columns).
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
      'profile_completed', p.profile_completed,
      'calibration_completed', p.calibration_completed,
      'first_task_completed', p.first_task_completed,
      'invited_at', p.invited_at,
      'onboarded_at', p.onboarded_at),

    'squad', (select jsonb_build_object(
                'id', q.id, 'name', q.name, 'role', m.membership_type,
                'contribution', m.contribution, 'joined_at', m.joined_at)
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
                               where student_id = p.id and status = 'passed')),

    'voice_recordings', (select count(*) from public.voice_explanations where student_id = p.id),

    -- Latest attempt per Lot (task_submissions).
    'recent_work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select * from (
          select distinct on (s.task_id) s.id, null::text as file_name, s.status,
                 s.sandbox_score as ai_score, s.created_at as submitted_at,
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
commit;
notify pgrst, 'reload schema';
