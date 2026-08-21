-- ============================================================================
-- Stage 15b — the four questions the TPO dashboard asks.
--
-- The specification lists fourteen REST endpoints under /tpo/. This product has
-- no service layer of that kind: screens read tables directly and row-level
-- rules decide what they may see. That works and is simpler, so it stays.
--
-- Functions are added only where row-level rules genuinely cannot answer the
-- question:
--   * counting across every student in a college, where reading each row would
--     be both slow and more access than the screen needs
--   * a transaction that must either fully happen or not happen at all
--
-- Everything else — the student list, standings, members, matches — stays a
-- plain table read, because a rule already says who may see it.
-- ============================================================================


-- ── who needs chasing, and why ──────────────────────────────────────────
-- §15 is explicit that at-risk should be explainable rules returning reasons,
-- never a stored boolean. A boolean tells a placement officer that something is
-- wrong; a reason tells them what to say when they pick up the phone.
create or replace function public.tpo_attention()
returns table (
  student_id   uuid,
  full_name    text,
  roll_number  text,
  branch       text,
  days_quiet   integer,
  reasons      text[],
  severity     text
) language sql stable security definer set search_path = public, pg_temp as $fn$
  with mine as (select public.my_college_id() as cid),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch,
           case when p.last_active is null then 999
                else (current_date - p.last_active::date) end as quiet,
           p.onboarding_status,
           (select count(*) from public.task_assignments ta
             where ta.student_id = p.id
               and ta.assigned_at >= date_trunc('week', now())
               and ta.status <> 'completed') as missed_this_week
      from public.student_profiles p, mine
     where p.college_id = mine.cid and mine.cid is not null
  )
  select b.id, b.full_name, b.roll_number, b.branch, b.quiet,
         array_remove(array[
           case when b.quiet >= 7
                then 'No activity for ' || b.quiet || ' days' end,
           case when b.onboarding_status <> 'completed'
                then 'Onboarding not finished (' || b.onboarding_status || ')' end,
           case when b.missed_this_week >= 2
                then b.missed_this_week || ' Lots not submitted this week' end
         ], null),
         case when b.quiet >= 14 or b.missed_this_week >= 3 then 'high'
              when b.quiet >= 7  or b.missed_this_week >= 2
                   or b.onboarding_status <> 'completed'     then 'medium'
              else 'low' end
    from base b
   where b.quiet >= 7
      or b.onboarding_status <> 'completed'
      or b.missed_this_week >= 2
   order by b.quiet desc;
$fn$;


-- ── HOME ────────────────────────────────────────────────────────────────
-- One call, one response. §11 lists six things this screen shows; fetching them
-- as six separate queries from the browser would be six round trips to render
-- one screen a placement officer looks at for ten seconds.
create or replace function public.tpo_home()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid := public.my_college_id();
  season record;
  result jsonb;
begin
  if cid is null then
    return jsonb_build_object('error','not a college account');
  end if;

  select s.id, s.name, s.planned_weeks, public.season_week(s.id) as week
    into season
    from public.seasons s
   where s.college_id = cid and s.is_current
   order by s.starts_on desc limit 1;

  select jsonb_build_object(
    'students', (select count(*) from public.student_profiles where college_id = cid),
    'active_this_week', (
      select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= now() - interval '7 days'),
    'active_today', (
      select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= current_date),
    'needs_attention', (select count(*) from public.tpo_attention()),
    'squads', (select count(*) from public.squads where college_id = cid),
    'reserves', (
      select count(*) from public.student_profiles p
       where p.college_id = cid
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)),
    'season', case when season.id is null then null else jsonb_build_object(
        'id', season.id, 'name', season.name,
        'week', season.week, 'planned_weeks', season.planned_weeks) end,
    'leader', (
      select jsonb_build_object('id', q.id, 'name', q.name, 'points', q.points)
        from public.squads q where q.college_id = cid
       order by q.points desc nulls last limit 1),
    'attention_breakdown', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select unnest(reasons) as reason, count(*) as students
          from public.tpo_attention() group by 1 order by 2 desc) t)
  ) into result;

  return result;
end $fn$;


-- ── STUDENTS ────────────────────────────────────────────────────────────
-- §12 asks for one "Student Operational Profile" response rather than making
-- the front end stitch six tables together. The squad and recency columns are
-- the whole reason this exists — a college can already read student_profiles,
-- but it cannot read task_assignments or squad membership for its students.
create or replace function public.tpo_students()
returns table (
  student_id  uuid,
  full_name   text,
  roll_number text,
  branch      text,
  batch       text,
  email       text,
  squad_id    uuid,
  squad_name  text,
  is_reserve  boolean,
  days_quiet  integer,
  trust_score numeric,
  total_xp    integer,
  onboarding_status text,
  lots_done   integer,
  attention   text
) language sql stable security definer set search_path = public, pg_temp as $fn$
  with mine as (select public.my_college_id() as cid),
  att as (select a.student_id, a.severity from public.tpo_attention() a)
  select p.id, p.full_name, p.roll_number, p.branch, p.batch, c.email,
         q.id, q.name,
         (m.id is null),
         case when p.last_active is null then 999
              else (current_date - p.last_active::date) end,
         p.trust_score, p.total_xp, p.onboarding_status,
         (select count(*)::int from public.task_assignments ta
           where ta.student_id = p.id and ta.status = 'completed'),
         coalesce(att.severity, 'ok')
    -- cross join, not a comma: a comma-separated FROM binds looser than the
    -- LEFT JOINs below it, so p would not be visible to them.
    from mine cross join public.student_profiles p
    left join public.student_contact c on c.student_id = p.id
    left join public.squad_members m on m.student_id = p.id and m.left_at is null
    left join public.squads q on q.id = m.squad_id
    left join att on att.student_id = p.id
   where p.college_id = mine.cid and mine.cid is not null
   order by p.full_name;
$fn$;


-- ── SQUADS: moving a reserve into a team ────────────────────────────────
-- §13 spells this out as a transaction: check eligibility, check no active
-- squad, check capacity, create the membership, update state, write the audit
-- record, commit — otherwise roll back. A function is the only place all of
-- that can be true at once.
create or replace function public.assign_to_squad(
  _student_id uuid,
  _squad_id   uuid,
  _effective  date default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid := public.my_college_id();
  squad record;
  student record;
  current_member record;
  member_count integer;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can assign its students to squads';
  end if;

  select * into student from public.student_profiles where id = _student_id;
  if student is null then raise exception 'no such student'; end if;
  if student.college_id is distinct from cid and not public.is_admin() then
    raise exception 'that student belongs to another college';
  end if;

  select * into squad from public.squads where id = _squad_id;
  if squad is null then raise exception 'no such squad'; end if;
  if squad.college_id is distinct from cid and not public.is_admin() then
    raise exception 'that squad belongs to another college';
  end if;

  -- Capacity, counted rather than assumed. max_members lives on the row, so a
  -- college running nine-a-side does not need different code.
  select count(*) into member_count from public.squad_members
   where squad_id = _squad_id and left_at is null;
  if member_count >= squad.max_members then
    raise exception '% is full (% of %)', squad.name, member_count, squad.max_members;
  end if;

  select * into current_member from public.squad_members
   where student_id = _student_id and left_at is null;

  if current_member.squad_id = _squad_id then
    raise exception '% is already in %', student.full_name, squad.name;
  end if;

  -- Leaving is recorded, not erased: the old row is closed rather than deleted,
  -- so the move can still be reconstructed a season later.
  if current_member.id is not null then
    update public.squad_members set left_at = now() where id = current_member.id;
  end if;

  insert into public.squad_members (squad_id, student_id, joined_at, assigned_by)
  values (_squad_id, _student_id, coalesce(_effective::timestamptz, now()), (select auth.uid()));

  perform public.write_audit(
    'STUDENT_ASSIGNED_TO_SQUAD', 'squad_members', _student_id,
    case when current_member.id is null then null
         else jsonb_build_object('squad_id', current_member.squad_id) end,
    jsonb_build_object('squad_id', _squad_id, 'effective', coalesce(_effective, current_date)),
    cid);

  return jsonb_build_object(
    'ok', true,
    'student', student.full_name,
    'squad', squad.name,
    'effective', coalesce(_effective, current_date),
    'members_now', member_count + 1,
    'max_members', squad.max_members);
end $fn$;


-- ── STUDENTS: sending a reminder ────────────────────────────────────────
-- Two things have to happen together, and neither is much use alone: the
-- student is told, and the fact that they were told is recorded. Without the
-- second, nobody can ever answer whether reminders work.
create or replace function public.tpo_send_reminder(
  _student_id uuid,
  _reason     text,
  _message    text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid := public.my_college_id();
  student record;
  iv uuid;
begin
  if cid is null then raise exception 'only a college can send a reminder'; end if;

  select * into student from public.student_profiles where id = _student_id;
  if student is null or student.college_id is distinct from cid then
    raise exception 'that student is not at your college';
  end if;

  insert into public.interventions (college_id, student_id, created_by, type, reason, message)
  values (cid, _student_id, (select auth.uid()), 'reminder', _reason,
          coalesce(_message, 'Your college has noticed you have been quiet. Pick up where you left off.'))
  returning id into iv;

  insert into public.notifications (user_id, type, title, message, link)
  values (_student_id, 'reminder', 'A nudge from your college',
          coalesce(_message, 'Your college has noticed you have been quiet. Pick up where you left off.'),
          '/student/dashboard');

  perform public.write_audit('REMINDER_SENT', 'interventions', iv, null,
                             jsonb_build_object('student_id', _student_id, 'reason', _reason), cid);

  return jsonb_build_object('ok', true, 'student', student.full_name, 'intervention_id', iv);
end $fn$;


-- ── INSIGHTS ────────────────────────────────────────────────────────────
-- Every number here is counted across every student in the college, which is
-- exactly the shape of question a per-row rule cannot answer cheaply.
create or replace function public.tpo_insights()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid := public.my_college_id();
  total integer;
begin
  if cid is null then return jsonb_build_object('error','not a college account'); end if;
  select count(*) into total from public.student_profiles where college_id = cid;

  return jsonb_build_object(
    'students', total,
    'participation_this_week', case when total = 0 then 0 else round(100.0 * (
        select count(distinct student_id) from public.student_activity_events
         where college_id = cid and occurred_at >= now() - interval '7 days') / total) end,
    'participation_last_week', case when total = 0 then 0 else round(100.0 * (
        select count(distinct student_id) from public.student_activity_events
         where college_id = cid
           and occurred_at >= now() - interval '14 days'
           and occurred_at <  now() - interval '7 days') / total) end,
    -- The skill-gap number the whole Insights screen is built around. It only
    -- became countable when needs_improvement was added as a fourth status.
    'skill_gaps', (
      select coalesce(jsonb_agg(g), '[]'::jsonb) from (
        select s.skill, count(*) as students
          from public.student_skills s
          join public.student_profiles p on p.id = s.student_id
         where p.college_id = cid and s.status = 'needs_improvement'
         group by s.skill order by 2 desc limit 8) g),
    'squad_health', (
      select coalesce(jsonb_agg(h), '[]'::jsonb) from (
        select q.name, q.points, q.wins, q.losses,
               (select count(*) from public.squad_members m
                 where m.squad_id = q.id and m.left_at is null) as members,
               (select count(distinct e.student_id) from public.student_activity_events e
                 join public.squad_members m2 on m2.student_id = e.student_id and m2.left_at is null
                where m2.squad_id = q.id and e.occurred_at >= now() - interval '7 days') as active_members
          from public.squads q where q.college_id = cid
         order by q.points desc nulls last) h),
    'attention_total', (select count(*) from public.tpo_attention())
  );
end $fn$;


-- ── who may call these ──────────────────────────────────────────────────
-- Every one of them resolves the caller's own college from their token and
-- refuses if there is not one, so a signed-in student calling them gets an
-- error or an empty set rather than another college's data.
revoke all on function public.tpo_attention()      from public, anon;
revoke all on function public.tpo_home()           from public, anon;
revoke all on function public.tpo_students()       from public, anon;
revoke all on function public.tpo_insights()       from public, anon;
revoke all on function public.assign_to_squad(uuid,uuid,date)     from public, anon;
revoke all on function public.tpo_send_reminder(uuid,text,text)   from public, anon;

grant execute on function public.tpo_attention()      to authenticated;
grant execute on function public.tpo_home()           to authenticated;
grant execute on function public.tpo_students()       to authenticated;
grant execute on function public.tpo_insights()       to authenticated;
grant execute on function public.assign_to_squad(uuid,uuid,date)   to authenticated;
grant execute on function public.tpo_send_reminder(uuid,text,text) to authenticated;
