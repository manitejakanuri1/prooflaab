-- 59: TPO, squads and leaderboard stop depending on the retired Trust score and
-- on the retired proof/assignment tables.
--   * tpo_students        - trust_score column removed; "Lots done" now counts distinct
--                           Lots passed (it counted task_assignments, which is empty,
--                           so every student showed 0).
--   * tpo_student_profile - no trust_score; task counts and recent work from
--                           task_submissions instead of task_assignments / proof_uploads.
--   * form_squads         - balances squads by XP, then Lots passed in the last 30 days.
--   * get_leaderboard     - trust_score column removed.
-- Return types change for two functions, so they are dropped and re-created (grants restored).
begin;

drop function if exists public.get_leaderboard(integer);
drop function if exists public.tpo_students(text,text,text,text,text,text,integer,integer);

CREATE OR REPLACE FUNCTION public.form_squads(_college_id uuid, _season_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  sid uuid; theme text;
  created integer := 0; placed integer := 0; filled integer;
  co record; n integer; k integer; existing integer; i integer;
  squad_ids uuid[]; new_id uuid; stu record; target uuid;
  pos integer; cycle integer; idx integer;
begin
  sid := coalesce(_season_id, public.ensure_season(_college_id));
  if sid is null then raise exception 'no season is running for this college'; end if;

  for co in
    select coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') as cohort,
           count(*) as students
      from public.student_profiles p
     where p.college_id = _college_id
       and p.onboarding_status <> 'blocked'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     group by 1
     order by 1
  loop
    n := co.students;

    -- NEW: seat students in squads that already exist for this section first,
    -- emptiest squad first, up to eleven (the twelfth seat stays free).
    filled := 0;
    for stu in
      select p.id
        from public.student_profiles p
       where p.college_id = _college_id
         and coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') = co.cohort
         and p.onboarding_status <> 'blocked'
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)
       order by coalesce(p.total_xp, 0) desc,
                (select count(distinct ts.task_id) from public.task_submissions ts
                  where ts.student_id = p.id and ts.status = 'passed'
                    and ts.created_at >= now() - interval '30 days') desc,
                p.roll_number nulls last, p.full_name
    loop
      select s.id into target
        from public.squads s
       where s.season_id = sid and s.archived_at is null
         and coalesce(s.cohort, 'GENERAL') = co.cohort
         and (select count(*) from public.squad_members m
               where m.squad_id = s.id and m.left_at is null) < 11
       order by (select count(*) from public.squad_members m
                  where m.squad_id = s.id and m.left_at is null), s.created_at
       limit 1;
      exit when target is null;

      insert into public.squad_members (squad_id, student_id, joined_at)
      values (target, stu.id, now());
      placed := placed + 1;
      filled := filled + 1;
    end loop;
    n := n - filled;

    -- From here on: stage54, unchanged. Whole elevens only; fewer than eleven
    -- left means no new squad, they wait for the college to decide.
    k := n / 11;
    continue when k < 1;

    select t.theme into theme
      from public.squad_name_themes t
     where t.branch = split_part(co.cohort, '-', 1)
       and (t.college_id = _college_id or t.college_id is null)
     order by t.college_id nulls last
     limit 1;
    if theme is null then
      select t.theme into theme
        from public.squad_name_themes t
       where t.branch = '*' and (t.college_id = _college_id or t.college_id is null)
       order by t.college_id nulls last
       limit 1;
    end if;
    theme := coalesce(theme, 'Squad');

    select count(*) into existing
      from public.squads s
     where s.season_id = sid and s.archived_at is null
       and coalesce(s.cohort, 'GENERAL') = co.cohort;

    squad_ids := '{}';
    for i in (existing + 1)..(existing + k) loop
      insert into public.squads (name, college_id, season_id, cohort, max_members)
      values (co.cohort || ' ' || theme || ' ' || i, _college_id, sid, co.cohort, 12)
      returning id into new_id;
      squad_ids := squad_ids || new_id;
      created := created + 1;
    end loop;

    pos := 0;
    for stu in
      select p.id
        from public.student_profiles p
       where p.college_id = _college_id
         and coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') = co.cohort
         and p.onboarding_status <> 'blocked'
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)
       order by coalesce(p.total_xp, 0) desc,
                (select count(distinct ts.task_id) from public.task_submissions ts
                  where ts.student_id = p.id and ts.status = 'passed'
                    and ts.created_at >= now() - interval '30 days') desc,
                p.roll_number nulls last, p.full_name
       limit k * 11
    loop
      cycle := pos / k;
      idx   := pos % k;
      if cycle % 2 = 1 then idx := k - 1 - idx; end if;

      insert into public.squad_members (squad_id, student_id, joined_at)
      values (squad_ids[idx + 1], stu.id, now());

      placed := placed + 1;
      pos := pos + 1;
    end loop;
  end loop;

  perform public.write_audit('SQUADS_FORMED', 'squads', _college_id, null,
    jsonb_build_object('squads_created', created, 'students_placed', placed), _college_id);

  return jsonb_build_object(
    'ok', true, 'squads_created', created, 'students_placed', placed,
    'cohorts', (select count(distinct cohort) from public.squads
                 where season_id = sid and archived_at is null),
    'reserve', (select count(*) from public.student_profiles p
                 where p.college_id = _college_id
                   and p.onboarding_status <> 'blocked'
                   and not exists (select 1 from public.squad_members m
                                    where m.student_id = p.id and m.left_at is null)));
end $function$;

CREATE OR REPLACE FUNCTION public.get_leaderboard(_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, full_name text, profile_photo_url text, total_xp integer, rank bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with me as (
    select college_id from public.student_profiles where id = (select auth.uid())
  )
  select p.id, p.full_name, p.profile_photo_url, p.total_xp,
         rank() over (order by p.total_xp desc, p.created_at)
  from public.student_profiles p
  where p.status = 'active'
    and (
      -- an admin sees the platform
      (select public.is_admin())
      -- everyone else sees their own college, and only if they have one
      or (p.college_id is not null
          and p.college_id = (select college_id from me))
    )
  order by p.total_xp desc, p.created_at
  limit greatest(_limit, 1);
$function$;

CREATE OR REPLACE FUNCTION public.tpo_students(_search text DEFAULT NULL::text, _branch text DEFAULT NULL::text, _batch text DEFAULT NULL::text, _squad text DEFAULT NULL::text, _status text DEFAULT NULL::text, _skill text DEFAULT NULL::text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(student_id uuid, full_name text, roll_number text, branch text, batch text, email text, squad_id uuid, squad_name text, is_reserve boolean, days_quiet integer, total_xp integer, onboarding_status text, lots_done integer, attention text, gap_skills text[], total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with mine as (select public.my_college_id() as cid),
  att as (select a.student_id, a.severity from public.tpo_attention() a),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch, p.batch, c.email,
           q.id as sq_id, q.name as sq_name, (m.id is null) as reserve,
           case when p.last_active is null then 999
                else (current_date - p.last_active::date) end as quiet,
           p.total_xp, p.onboarding_status,
           coalesce(att.severity, 'ok') as attn,
           coalesce((select array_agg(s.skill order by s.skill)
                       from public.student_skills s
                      where s.student_id = p.id and s.status = 'needs_improvement'),
                    '{}'::text[]) as gaps
      from mine cross join public.student_profiles p
      left join public.student_contact c on c.student_id = p.id
      left join public.squad_members m on m.student_id = p.id and m.left_at is null
      left join public.squads q on q.id = m.squad_id
      left join att on att.student_id = p.id
     where p.college_id = mine.cid and mine.cid is not null
  ),
  filtered as (
    select * from base b
     where (_search is null or _search = ''
            or b.full_name  ilike '%' || _search || '%'
            or b.roll_number ilike '%' || _search || '%'
            or b.email      ilike '%' || _search || '%')
       and (_branch is null or _branch = 'all' or b.branch = _branch)
       and (_batch  is null or _batch  = 'all' or b.batch  = _batch)
       and (_squad  is null or _squad  = 'all'
            or (_squad = 'reserve' and b.reserve)
            or b.sq_name = _squad)
       and (_skill  is null or _skill  = 'all' or _skill = any(b.gaps))
       and (_status is null or _status = 'all'
            or (_status = 'attention'    and b.attn <> 'ok')
            or (_status = 'inactive'     and b.quiet >= 7)
            or (_status = 'onboarding'   and b.onboarding_status <> 'completed')
            or (_status = 'active_today' and b.quiet = 0)
            or (_status = 'active_week'  and b.quiet <= 7))
  )
  select f.id, f.full_name, f.roll_number, f.branch, f.batch, f.email,
         f.sq_id, f.sq_name, f.reserve, f.quiet, f.total_xp,
         f.onboarding_status,
         -- Counted only for the page being shown, not for all ten thousand.
         -- Lots done = distinct Lots the student has passed (task_submissions).
         (select count(distinct s.task_id)::int from public.task_submissions s
           where s.student_id = f.id and s.status = 'passed'),
         f.attn, f.gaps,
         count(*) over () as total_count
    from filtered f
   order by f.full_name
   limit greatest(1, least(coalesce(_limit, 50), 200))
  offset greatest(0, coalesce(_offset, 0));
$function$;

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

revoke all on function public.get_leaderboard(integer) from public, anon;
grant execute on function public.get_leaderboard(integer) to authenticated, service_role;
revoke all on function public.tpo_students(text,text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.tpo_students(text,text,text,text,text,text,integer,integer) to authenticated, service_role;

do $$
declare f text; body text;
begin
  foreach f in array array[
    'public.form_squads(uuid,uuid)', 'public.get_leaderboard(integer)',
    'public.tpo_student_profile(uuid)',
    'public.tpo_students(text,text,text,text,text,text,integer,integer)']
  loop
    body := pg_get_functiondef(f::regprocedure);
    if body ~ 'trust_score|proof_uploads|task_assignments' then
      raise exception '59 self-check: % still reads a retired source', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.tpo_students(text,text,text,text,text,text,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.get_leaderboard(integer)', 'execute') then
    raise exception '59 self-check: anon can execute a TPO/leaderboard function';
  end if;
  if not has_function_privilege('authenticated', 'public.tpo_students(text,text,text,text,text,text,integer,integer)', 'execute') then
    raise exception '59 self-check: signed-in users lost tpo_students';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
