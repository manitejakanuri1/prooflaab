-- ============================================================================
-- Stage 54 — squads are elevens, and the college places whoever is left over.
--
-- Stage 49 spread every student in a cohort across round(n/11) squads, so sizes
-- landed anywhere in 10-12 and nobody was ever left out. That is one reading of
-- the blueprint's 10-12 band. The project owner's decision is the other one,
-- and it is the one that now holds:
--
--   a squad is eleven students. If a cohort does not divide by eleven, the
--   remainder is NOT quietly spread around to make uneven squads - it is left
--   unassigned, and the college decides what to do with those students from
--   their own dashboard.
--
-- So a section of 77 makes seven squads of eleven and nobody is left. A section
-- of 70 makes six squads of eleven and leaves four students for the college -
-- who can put them into existing squads (each has one free seat, max_members is
-- twelve), create a squad of their own, or leave them out of the league this
-- season. That is a decision about real students in a real college, and it
-- belongs to the person who knows them.
--
-- What stage 49 brought and this keeps: squads are formed inside a cohort, and
-- members are dealt out in a snake by experience so no squad collects all the
-- strongest students.
--
-- Also here: tpo_create_squad. Until now a college could rename, lock, archive
-- and rebalance squads but could not make one, so "the college adds them on
-- their own" had nowhere to go once every squad was full.
-- ============================================================================

create or replace function public.form_squads(_college_id uuid, _season_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  sid uuid; theme text;
  created integer := 0; placed integer := 0;
  co record; n integer; k integer; existing integer; i integer;
  squad_ids uuid[]; new_id uuid; stu record;
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

    -- Whole elevens only. A cohort of fewer than eleven makes no squad at all;
    -- those students wait for the college to decide, exactly like a remainder.
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
      -- max_members is twelve, not eleven: the squad is built with eleven and
      -- the spare seat is what lets a college place a leftover student later
      -- without having to raise the limit first.
      insert into public.squads (name, college_id, season_id, cohort, max_members)
      values (co.cohort || ' ' || theme || ' ' || i, _college_id, sid, co.cohort, 12)
      returning id into new_id;
      squad_ids := squad_ids || new_id;
      created := created + 1;
    end loop;

    -- Snake draft over exactly k * 11 students, strongest first. The remainder
    -- are the ones the ordering leaves at the end, so a college placing them by
    -- hand is placing its least experienced students - which is worth knowing
    -- when deciding where they go.
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

-- A college can now make a squad, which is what "we will add them ourselves"
-- needs when every existing squad is full.
create or replace function public.tpo_create_squad(_name text, _cohort text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cid uuid := public.my_college_id();
  sid uuid; new_id uuid; nm text := nullif(trim(coalesce(_name, '')), '');
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can create its own squads';
  end if;
  if nm is null then raise exception 'a squad needs a name'; end if;

  sid := public.ensure_season(cid);
  if sid is null then raise exception 'no season is running for this college'; end if;

  if exists (select 1 from public.squads
              where season_id = sid and archived_at is null and lower(name) = lower(nm)) then
    raise exception 'there is already a squad called % this season', nm;
  end if;

  insert into public.squads (name, college_id, season_id, cohort, max_members)
  values (nm, cid, sid, nullif(trim(coalesce(_cohort, '')), ''), 12)
  returning id into new_id;

  perform public.write_audit('SQUAD_CREATED', 'squads', new_id, null,
    jsonb_build_object('name', nm, 'cohort', _cohort), cid);

  return jsonb_build_object('ok', true, 'squad_id', new_id, 'name', nm,
                            'cohort', _cohort, 'max_members', 12);
end $function$;

-- Who is waiting to be placed, and which cohort they belong to. The Assign
-- screen needs the cohort or a TPO cannot tell which squad a reserve should
-- join.
create or replace function public.tpo_reserves()
returns table(student_id uuid, full_name text, roll_number text,
              cohort text, total_xp integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id, p.full_name, p.roll_number,
         coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL'),
         coalesce(p.total_xp, 0)
    from public.student_profiles p
   where (p.college_id = public.my_college_id() or public.is_admin())
     and p.college_id is not null
     and p.onboarding_status <> 'blocked'
     and not exists (select 1 from public.squad_members m
                      where m.student_id = p.id and m.left_at is null)
   order by coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL'),
            p.roll_number nulls last, p.full_name;
$function$;

revoke all on function public.tpo_create_squad(text, text) from public, anon, authenticated;
revoke all on function public.tpo_reserves()                from public, anon, authenticated;
grant execute on function public.tpo_create_squad(text, text) to authenticated, service_role;
grant execute on function public.tpo_reserves()                to authenticated, service_role;
