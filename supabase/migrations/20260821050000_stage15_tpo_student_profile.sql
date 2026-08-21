-- §3.2: one Student Operational Profile response, so opening a student does not
-- make the front end stitch six tables together — and so a college can see the
-- parts of a student it has no direct read on. task_assignments,
-- voice_explanations and student_skills are all closed to a college by row
-- rules. A college is entitled to them for its OWN students, and that is a
-- distinction a function can make and a policy on a table cannot.
--
-- The permission check is written the long way on purpose. The first version
-- was:
--
--   if not (p.college_id = cid or is_admin() or p.id = auth.uid())
--
-- and it had a hole. A student has no colleges row, so my_college_id() returns
-- NULL. Opening a student who also had no college made that NULL = NULL, which
-- is NULL rather than false; NULL or false is NULL; and `if NULL then` does not
-- fire. The guard fell straight through and returned the record. Found by
-- having a student open somebody at another college and getting their name
-- back. Every branch below is explicitly boolean, and coalesce sends an
-- unknown to refusal — the only safe direction for an unknown in a permission
-- check to resolve.
create or replace function public.tpo_student_profile(_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
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
    'trust_score', p.trust_score,
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

    -- Activity as counts by kind over the last month: enough to say what this
    -- student actually does, without shipping a thousand event rows.
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
      'assigned',  (select count(*) from public.task_assignments where student_id = p.id),
      'completed', (select count(*) from public.task_assignments
                     where student_id = p.id and status = 'completed')),

    'voice_recordings', (select count(*) from public.voice_explanations where student_id = p.id),

    -- proof_uploads has no repo url and no created_at: the file name is what
    -- was submitted, submitted_at is when, and ai_score is the machine's read
    -- of it before any human looked.
    'recent_work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select pu.id, pu.file_name, pu.status, pu.ai_score,
               pu.admin_review_status, pu.submitted_at,
               (select t.title from public.tasks t where t.id = pu.task_id) as task_title
          from public.proof_uploads pu
         where pu.student_id = p.id
         order by pu.submitted_at desc nulls last limit 5) w),

    'interventions', (select coalesce(jsonb_agg(jsonb_build_object(
                        'type', i.type, 'reason', i.reason, 'created_at', i.created_at)
                        order by i.created_at desc), '[]'::jsonb)
                        from public.interventions i where i.student_id = p.id)
  );
end $fn$;

revoke all on function public.tpo_student_profile(uuid) from public, anon;
grant execute on function public.tpo_student_profile(uuid) to authenticated;
