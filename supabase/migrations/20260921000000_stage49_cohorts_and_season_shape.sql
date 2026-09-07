-- ============================================================================
-- Stage 49 — cohorts, balanced squads, and the twelve-week season shape.
--
-- From the Squad System Blueprint. Four things change.
--
-- 1. COHORT. Until now squads were grouped by `branch` — CSE, ECE — so every
--    CSE student in a college competed as one pool. The blueprint's unit is the
--    academic section: CSE-A, CSE-B. `student_profiles.cohort` holds it, and
--    `squads.cohort` records which one a squad was built from, so a league can
--    be run inside a cohort instead of across the whole college.
--    Backfilled to the branch, which is exactly what the old behaviour was, so
--    nothing changes for a college that never supplies sections.
--
-- 2. SQUAD SIZES 10-12, AND EVERYBODY PLAYS. form_squads used to create only
--    whole squads of exactly eleven — floor(students / 11) — and leave the
--    remainder in a "reserve" that never competed. 65 students became five
--    squads and ten spectators. It now picks a squad count of round(n / 11)
--    and deals every student out, so sizes land one apart and inside the
--    blueprint's 10-12 band.
--
--    Checked against the blueprint's own examples: 77 -> 7 squads of 11;
--    65 -> six squads (11,11,11,11,11,10); 80 -> seven of 11-12. The one it
--    reads differently is 70, which the blueprint lists as 7 x 10 and this
--    makes six of 11-12 — both legal, and six is closer to the stated
--    preferred size of eleven.
--
-- 3. BALANCED, NOT ALPHABETICAL. The old code filled squad 1 with the first
--    eleven students by roll number, so a squad's strength depended on where
--    its members' names fell in the register. Students are now ranked by
--    experience and dealt out in a snake — 1,2,3,3,2,1 — which is the standard
--    way to stop every strong student landing in the same team. Section 4 of
--    the blueprint asks for exactly this: "distribute capability rather than
--    deliberately grouping all toppers together".
--
-- 4. SEASON SHAPE. Seasons opened as ten flat weeks. The blueprint's season is
--    twelve weeks by default, fifteen at most, and divided into named phases.
--    season_phase() names the phase for any week and season_plan() returns the
--    whole calendar, both derived from planned_weeks so a 15-week season
--    stretches the league and championship instead of breaking.
--
--        weeks 1-2   foundation      calibration and squad formation
--        weeks 3-6   league          round robin inside each cohort
--        weeks 7-9   championship    inter-cohort
--        week  10    seeding         qualification and seeding
--        week  11    knockout        championship stage
--        week  12    final           grand final and season close
-- ============================================================================

alter table public.student_profiles add column if not exists cohort text;
alter table public.squads           add column if not exists cohort text;

comment on column public.student_profiles.cohort is
  'Academic section, e.g. CSE-A. The unit squads are formed inside. Falls back to branch when a college supplies no section.';
comment on column public.squads.cohort is
  'The cohort this squad was formed from. A cohort league only pairs squads that share this value.';

update public.student_profiles
   set cohort = nullif(trim(branch), '')
 where cohort is null;

create index if not exists student_profiles_cohort_idx
  on public.student_profiles (college_id, cohort);
create index if not exists squads_cohort_idx
  on public.squads (season_id, cohort);

-- ---------------------------------------------------------------- season shape

alter table public.seasons alter column planned_weeks set default 12;

update public.seasons set planned_weeks = 12
 where planned_weeks is null or planned_weeks < 6 or planned_weeks > 15;

alter table public.seasons drop constraint if exists seasons_planned_weeks_check;
alter table public.seasons add constraint seasons_planned_weeks_check
  check (planned_weeks between 6 and 15);

create or replace function public.season_plan(_season_id uuid)
returns table(week integer, phase text, label text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  -- The two ends of the season are fixed: two weeks of foundation at the
  -- start, and seeding / knockout / final at the finish. Everything between
  -- is split between the cohort league and the inter-cohort championship in
  -- the same 4:3 proportion the blueprint's twelve-week table uses, so a
  -- fifteen-week season lengthens both instead of inventing a new shape.
  with s as (
    select greatest(coalesce(planned_weeks, 12), 6) as weeks
      from public.seasons where id = _season_id
  ), split as (
    select weeks,
           2 as foundation,
           ceil((weeks - 5) * 4.0 / 7.0)::int as league,
           (weeks - 5) - ceil((weeks - 5) * 4.0 / 7.0)::int as championship
      from s
  )
  select w.week,
         case
           when w.week <= split.foundation then 'foundation'
           when w.week <= split.foundation + split.league then 'league'
           when w.week <= split.foundation + split.league + split.championship then 'championship'
           when w.week = split.weeks - 2 then 'seeding'
           when w.week = split.weeks - 1 then 'knockout'
           else 'final'
         end as phase,
         case
           when w.week <= split.foundation then 'Foundation, calibration and squad formation'
           when w.week <= split.foundation + split.league then 'Cohort league - round robin'
           when w.week <= split.foundation + split.league + split.championship then 'Inter-cohort championship'
           when w.week = split.weeks - 2 then 'Qualification and seeding'
           when w.week = split.weeks - 1 then 'Championship stage'
           else 'Grand final and season close'
         end as label
    from split, generate_series(1, split.weeks) as w(week);
$function$;

create or replace function public.season_phase(_season_id uuid, _week integer default null)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select p.phase from public.season_plan(_season_id) p
   where p.week = coalesce(_week, public.season_week(_season_id))
   limit 1;
$function$;

-- The last league week. Everything about qualification hangs off this number:
-- the blueprint's "if a squad fails to qualify after Week 6".
create or replace function public.season_league_last_week(_season_id uuid)
returns integer
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select max(p.week) from public.season_plan(_season_id) p where p.phase = 'league';
$function$;

-- ------------------------------------------------------------ squad formation

create or replace function public.form_squads(_college_id uuid, _season_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  sid uuid; town text; theme text;
  created integer := 0; placed integer := 0;
  co record; n integer; k integer; existing integer; i integer;
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

    -- Preferred size is eleven. Take one more squad only when that keeps
    -- every squad at ten or more, so the 10-12 band is respected wherever
    -- the arithmetic allows it at all.
    k := greatest(1, round(n / 11.0)::int);
    if ceil(n::numeric / k) > 12 and floor(n::numeric / (k + 1)) >= 10 then
      k := k + 1;
    end if;

    -- The naming theme is still keyed on branch, so a cohort like 'CSE-A'
    -- looks its branch up by taking the part before the dash.
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

    -- Snake draft. Strongest first, dealt 1..k then k..1, so consecutive
    -- picks land in different squads and no squad collects all the toppers.
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

-- Rebalancing must not move a student out of their own cohort's league.
create or replace function public.tpo_rebalance_squads()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cid    uuid := public.my_college_id();
  moved  integer := 0;
  stu    record;
  target uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can rebalance its own squads';
  end if;

  for stu in
    select p.id,
           coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') as cohort
      from public.student_profiles p
     where p.college_id = cid
       and p.onboarding_status <> 'blocked'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     order by p.roll_number nulls last, p.full_name
  loop
    select s.id into target
      from public.squads s
     where s.college_id = cid
       and s.archived_at is null
       and not s.is_locked
       and coalesce(s.cohort, 'GENERAL') = stu.cohort
       and (select count(*) from public.squad_members m
             where m.squad_id = s.id and m.left_at is null) < s.max_members
     order by (select count(*) from public.squad_members m
                where m.squad_id = s.id and m.left_at is null)
     limit 1;

    continue when target is null;

    insert into public.squad_members (squad_id, student_id, joined_at)
    values (target, stu.id, now());
    moved := moved + 1;
  end loop;

  perform public.write_audit('SQUADS_REBALANCED', 'squads', cid, null,
    jsonb_build_object('students_placed', moved), cid);

  return jsonb_build_object('ok', true, 'students_placed', moved,
    'still_unplaced', (select count(*) from public.student_profiles p
                        where p.college_id = cid
                          and p.onboarding_status <> 'blocked'
                          and not exists (select 1 from public.squad_members m
                                           where m.student_id = p.id and m.left_at is null)));
end $function$;

-- A new season is twelve weeks, not ten.
create or replace function public.ensure_season(_college_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare sid uuid; n integer; nm text;
begin
  if _college_id is null then return null; end if;

  select id into sid from public.seasons
   where college_id = _college_id and is_current
   order by starts_on desc limit 1;
  if sid is not null then return sid; end if;

  select count(*) into n from public.seasons where college_id = _college_id;
  nm := 'Season ' || (n + 1);

  insert into public.seasons (name, college_id, starts_on, ends_on,
                              is_current, planned_weeks, status)
  values (nm, _college_id, current_date, current_date + (12 * 7), true, 12, 'active')
  returning id into sid;

  perform public.write_audit('SEASON_OPENED', 'seasons', sid, null,
    jsonb_build_object('name', nm, 'planned_weeks', 12), _college_id);

  return sid;
end $function$;

revoke all on function public.season_plan(uuid)                from public, anon, authenticated;
revoke all on function public.season_phase(uuid, integer)      from public, anon, authenticated;
revoke all on function public.season_league_last_week(uuid)    from public, anon, authenticated;
grant execute on function public.season_plan(uuid)             to authenticated, service_role;
grant execute on function public.season_phase(uuid, integer)   to authenticated, service_role;
grant execute on function public.season_league_last_week(uuid) to authenticated, service_role;
