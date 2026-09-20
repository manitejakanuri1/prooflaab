-- Removing students can leave squads empty. Two changes (owner's request, 20 Sep 2026):
--
--  1. tpo_empty_squads() / tpo_delete_empty_squads(): the college dashboard asks
--     "remove the empty squads too?" after a removal. Yes deletes them (their
--     fixtures and weekly rows go with them, by the existing ON DELETE CASCADE).
--     No keeps them.
--  2. form_squads(): before drawing NEW squads for a section, fill the squads
--     that already exist there, up to eleven each (the twelfth seat stays free),
--     emptiest first. So after "keep the squads", a re-import goes back into
--     the same squads instead of making Titans 3 and 4 beside two empty ones.
--     Everything after the top-up is the stage54 logic, unchanged.
--
-- Rollback: re-run form_squads() from
-- supabase/migrations/20260926000000_stage54_squads_of_eleven_college_places_the_rest.sql
-- and drop the two tpo_*_empty_squads functions.
begin;

create or replace function public.tpo_empty_squads()
returns integer
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::integer
    from public.squads s
   where s.college_id = public.my_college_id()
     and s.archived_at is null
     and not exists (select 1 from public.squad_members m
                      where m.squad_id = s.id and m.left_at is null);
$function$;

create or replace function public.tpo_delete_empty_squads()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cid uuid := public.my_college_id();
  gone integer;
begin
  if cid is null then
    raise exception 'only a college can remove its own squads';
  end if;

  with d as (
    delete from public.squads s
     where s.college_id = cid
       and s.archived_at is null
       and not exists (select 1 from public.squad_members m
                        where m.squad_id = s.id and m.left_at is null)
    returning s.id
  )
  select count(*)::integer into gone from d;

  if gone > 0 then
    perform public.write_audit('EMPTY_SQUADS_REMOVED', 'squads', cid, null,
      jsonb_build_object('squads_removed', gone), cid);
  end if;
  return gone;
end $function$;

revoke all on function public.tpo_empty_squads()        from public, anon;
revoke all on function public.tpo_delete_empty_squads() from public, anon;
grant execute on function public.tpo_empty_squads()        to authenticated, service_role;
grant execute on function public.tpo_delete_empty_squads() to authenticated, service_role;

create or replace function public.form_squads(_college_id uuid, _season_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
                coalesce(p.trust_score, 0) desc,
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
                coalesce(p.trust_score, 0) desc,
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

-- form_squads keeps the grants stage23 gave it: the server calls it, browsers do not.
revoke all on function public.form_squads(uuid, uuid) from public, anon, authenticated;
grant execute on function public.form_squads(uuid, uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.tpo_delete_empty_squads()', 'EXECUTE') then
    raise exception 'anon can delete squads';
  end if;
  if not has_function_privilege('authenticated', 'public.tpo_delete_empty_squads()', 'EXECUTE') then
    raise exception 'a college cannot call tpo_delete_empty_squads';
  end if;
  if not has_function_privilege('service_role', 'public.form_squads(uuid, uuid)', 'EXECUTE') then
    raise exception 'service_role cannot call form_squads';
  end if;
  if has_function_privilege('authenticated', 'public.form_squads(uuid, uuid)', 'EXECUTE') then
    raise exception 'a browser session can call form_squads directly';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
