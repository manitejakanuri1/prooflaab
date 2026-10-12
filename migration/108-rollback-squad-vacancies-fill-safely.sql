-- 108 rollback: form_squads and form_all_colleges exactly as migration 59 and stage 33 left them (copied verbatim).
-- After this, a locked squad with a free seat again makes the whole nightly run fail for its college, and that failure
-- is again only a NOTICE. Nothing else changes: memberships placed while 108 was live stay (they are real and valid).
begin;

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

create or replace function public.form_all_colleges()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c record; made integer := 0; placed integer := 0; r jsonb;
begin
  for c in
    select distinct s.college_id from public.seasons s
     where s.is_current and s.status = 'active' and s.college_id is not null
  loop
    begin
      r := public.form_squads(c.college_id);
      made   := made   + coalesce((r->>'squads_created')::int, 0);
      placed := placed + coalesce((r->>'students_placed')::int, 0);
    exception when others then
      -- One college's problem must not stop every other college's morning.
      raise notice 'squad formation failed for %: %', c.college_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'squads_created', made,
                            'students_placed', placed, 'ran_at', now());
end $fn$;
revoke all on function public.form_all_colleges() from public, anon, authenticated;
grant execute on function public.form_all_colleges() to service_role;

do $$
begin
  if position('-- 108:' in pg_get_functiondef('public.form_squads(uuid,uuid)'::regprocedure)) > 0 then
    raise exception '108 rollback self-check: form_squads still has the 108 changes';
  end if;
  if position('colleges_failed' in pg_get_functiondef('public.form_all_colleges()'::regprocedure)) > 0 then
    raise exception '108 rollback self-check: form_all_colleges still has the 108 changes';
  end if;
  if has_function_privilege('authenticated', 'public.form_squads(uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.form_squads(uuid,uuid)', 'execute') then
    raise exception '108 rollback self-check: form_squads privileges wrong';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
