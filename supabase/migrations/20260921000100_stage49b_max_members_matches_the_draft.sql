-- ============================================================================
-- Stage 49b — max_members must match the squad actually built.
--
-- form_squads set every squad's max_members to 12, the blueprint's maximum.
-- For most cohorts that is right, but the 10-12 band cannot always be met: a
-- cohort of 25 splits into 12 and 13, and one of 13 stays a single squad of
-- 13, because the alternative (three squads of 8, or two of 6 and 7) is
-- further from the preferred size of eleven, not closer.
--
-- form_squads inserts members directly and no trigger enforces max_members, so
-- those squads were created fine — but tpo_rebalance_squads and the Manage
-- screen both read max_members as "is there room here", and a full squad of 13
-- with max_members 12 reads as over-full forever. The cap is now the larger of
-- 12 and the squad's own planned size, so it always describes the squad it is
-- attached to.
-- ============================================================================

create or replace function public.form_squads(_college_id uuid, _season_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  sid uuid; town text; theme text;
  created integer := 0; placed integer := 0;
  co record; n integer; k integer; cap integer; existing integer; i integer;
  squad_ids uuid[]; new_id uuid; stu record;
  pos integer; cycle integer; idx integer;
begin
  sid := coalesce(_season_id, public.ensure_season(_college_id));
  if sid is null then raise exception 'no season is running for this college'; end if;

  town := public.squad_town(_college_id);

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
    continue when n < 1;

    k := greatest(1, round(n / 11.0)::int);
    if ceil(n::numeric / k) > 12 and floor(n::numeric / (k + 1)) >= 10 then
      k := k + 1;
    end if;
    cap := greatest(12, ceil(n::numeric / k)::int);

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
      values (co.cohort || ' ' || theme || ' ' || i, _college_id, sid, co.cohort, cap)
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
