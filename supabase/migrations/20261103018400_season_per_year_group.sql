-- 184 (owner, 31 Oct 2026): one season per year group, squads on any day, a championship in every section.
--   1. Seasons belong to a year group (seasons.year_group = passing-out year, migration 183). Each year group of a
--      college runs its own season, side by side. Old seasons keep plan_version 1 and their old shape.
--   2. New seasons (plan_version 2), 12 weeks: league weeks 1-10 inside each section, semi-finals week 11,
--      final week 12. Every section has its own champion:
--        1 squad: no champion | 2: final | 3: seed 1 waits in the final, semi 2 v 3 | 4+: semis 1 v 4, 2 v 3.
--      Optional: the college pools chosen sections (seasons.cross_sections); the top 4 of the pool play one
--      semi-final + final instead of their own. Can be changed only before the semi-finals.
--   3. Squads form on any day (179's week-1-only rule is gone). A late student takes a free seat in their
--      section, else waits in Reserve; 11 waiting make a new squad; a late section joins the running season and
--      gets fixtures for the league weeks left.
--   4. Seasons run back to back. After a season closes there are 3 days off (no Daily Lot, roadmap only), then
--      the next season opens with the same squads, points from 0. The 1 June fresh start is gone; instead the
--      college presses "Make fresh squads" (seasons.fresh_squads_next) and the next season deals new squads.
--   5. A college picks which year group its screens show (colleges.viewing_year_group, 0 = no year set); every
--      screen that asks my_season_id() follows that choice. A student always sees their own year group.
-- Rollback: migration/184-rollback-season-per-year-group.sql
begin;

alter table public.seasons add column if not exists year_group integer;
alter table public.seasons add column if not exists plan_version integer not null default 1;
alter table public.seasons add column if not exists fresh_squads_next boolean not null default false;
alter table public.seasons add column if not exists cross_sections text[];
alter table public.squads add column if not exists bracket text;
alter table public.colleges add column if not exists viewing_year_group integer;

-- Old seasons: the year group most of their squad members are in.
update public.seasons s set year_group = (
  select p.passing_out_year from public.squads q
    join public.squad_members m on m.squad_id = q.id
    join public.student_profiles p on p.id = m.student_id
   where q.season_id = s.id and p.passing_out_year is not null
   group by 1 order by count(*) desc, 1 limit 1)
 where s.year_group is null;

create unique index if not exists seasons_one_current_per_year_group
  on public.seasons (college_id, coalesce(year_group, 0)) where is_current;

create table if not exists public.season_champions (
  season_id uuid not null references public.seasons(id) on delete cascade,
  bracket text not null,
  champion_squad_id uuid references public.squads(id),
  runner_up_squad_id uuid references public.squads(id),
  third_squad_id uuid references public.squads(id),
  decided_by text not null default 'final',
  created_at timestamptz not null default now(),
  primary key (season_id, bracket));
alter table public.season_champions enable row level security;
drop policy if exists season_champions_read on public.season_champions;
create policy season_champions_read on public.season_champions for select to authenticated
  using (public.can_see_season(season_id));
revoke all on public.season_champions from public, anon;
grant select on public.season_champions to authenticated;
grant all on public.season_champions to service_role;

-- The days off between two seasons: 3 days (5 minutes in PRAGATI's fast test season).
create or replace function public.season_gap(_season_id uuid)
returns interval language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when public.test_fast_season(_season_id) then interval '5 minutes' else interval '3 days' end;
$fn$;

CREATE OR REPLACE FUNCTION public.season_plan(_season_id uuid)
 RETURNS TABLE(week integer, phase text, label text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with s as (
    select greatest(coalesce(planned_weeks, 12), 6) as weeks, plan_version
      from public.seasons where id = _season_id
  ), split as (
    select weeks, plan_version,
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
    from split, generate_series(1, split.weeks) as w(week)
   where split.plan_version is distinct from 2
  union all
  -- 184: league in each section, then semi-finals and the final
  select w.week,
         case when w.week <= s.weeks - 2 then 'league' when w.week = s.weeks - 1 then 'knockout' else 'final' end,
         case when w.week <= s.weeks - 2 then 'Section league'
              when w.week = s.weeks - 1 then 'Semi-finals' else 'Final and season close' end
    from s, generate_series(1, s.weeks) as w(week)
   where s.plan_version = 2
   order by 1;
$function$;

-- The running season of one year group. Opens the next one once the 3 days off are over (null until then).
drop function if exists public.ensure_season(uuid);
create or replace function public.ensure_season(_college_id uuid, _year_group integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare sid uuid; n integer; nm text; last record;
begin
  if _college_id is null then return null; end if;
  select id into sid from public.seasons
   where college_id = _college_id and is_current and year_group is not distinct from _year_group
   order by starts_on desc limit 1;
  if sid is not null then return sid; end if;
  select * into last from public.seasons
   where college_id = _college_id and year_group is not distinct from _year_group and status = 'complete'
   order by completed_at desc nulls last limit 1;
  if last.id is not null and now() < last.completed_at + public.season_gap(last.id) then
    return null;  -- the days off between seasons
  end if;
  select count(*) into n from public.seasons
   where college_id = _college_id and year_group is not distinct from _year_group;
  nm := 'Season ' || (n + 1);
  insert into public.seasons (name, college_id, starts_on, ends_on, is_current, planned_weeks, status,
                              year_group, plan_version)
  values (nm, _college_id, current_date, current_date + (12 * 7), true, 12, 'active', _year_group, 2)
  returning id into sid;
  perform public.write_audit('SEASON_OPENED', 'seasons', sid, null,
    jsonb_build_object('name', nm, 'planned_weeks', 12, 'year_group', _year_group), _college_id);
  perform public.carry_over_squads(sid);
  return sid;
end $fn$;
revoke all on function public.ensure_season(uuid, integer) from public, anon, authenticated;
grant execute on function public.ensure_season(uuid, integer) to service_role;

-- A college no longer opens a season the moment it is created: seasons open when its students arrive.
CREATE OR REPLACE FUNCTION public.colleges_open_season()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return new;
end $function$;

-- Same squads into the next season of the same year group, unless the college asked for fresh squads.
create or replace function public.carry_over_squads(_season_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  s record; prev record; q record; new_id uuid;
begin
  select * into s from public.seasons where id = _season_id;
  if s.id is null then return 0; end if;
  select * into prev from public.seasons
   where college_id = s.college_id and id <> s.id and status = 'complete' and completed_at is not null
     and year_group is not distinct from s.year_group
   order by completed_at desc limit 1;
  if prev.id is null or prev.fresh_squads_next then return 0; end if;
  if exists (select 1 from public.squads where season_id = s.id and archived_at is null) then return 0; end if;

  perform set_config('app.system_write', 'on', true);
  for q in select * from public.squads where season_id = prev.id order by name loop
    insert into public.squads (name, college_id, season_id, cohort, max_members)
    values (q.name, q.college_id, s.id, q.cohort, q.max_members)
    returning id into new_id;
    insert into public.squad_members (squad_id, student_id, role, membership_type, joined_at)
    select new_id, m.student_id, m.role, m.membership_type, now()
      from public.squad_members m
      join public.student_profiles p on p.id = m.student_id
     where m.squad_id = q.id
       and m.left_at = prev.completed_at
       and p.college_id = s.college_id
       and p.onboarding_status <> 'blocked'
       and p.cohort is not distinct from q.cohort
       and p.passing_out_year is not distinct from s.year_group
       and not exists (select 1 from public.squad_members x where x.student_id = m.student_id and x.left_at is null);
  end loop;
  delete from public.squads n
   where n.season_id = s.id
     and not exists (select 1 from public.squad_members m where m.squad_id = n.id and m.left_at is null);
  perform set_config('app.system_write', 'off', true);

  perform public.write_audit('SQUADS_CARRIED_OVER', 'squads', s.id, null,
    jsonb_build_object('from_season', prev.id,
                       'squads', (select count(*) from public.squads where season_id = s.id)), s.college_id);
  return (select count(*)::int from public.squads where season_id = s.id);
end $fn$;
revoke all on function public.carry_over_squads(uuid) from public, anon, authenticated;
grant execute on function public.carry_over_squads(uuid) to service_role;

-- Seats the waiting students of one season's year group (the body of 179's form_squads, without its week-1
-- rule), then gives new squads their league fixtures.
create or replace function public.form_squads_in(_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  sid uuid := _season_id; cid uuid; yg integer; theme text;
  created integer := 0; placed integer := 0; filled integer;
  co record; n integer; k integer; existing integer; i integer;
  squad_ids uuid[]; new_id uuid; stu record; target uuid;
  pos integer; cycle integer; idx integer;
begin
  select college_id, year_group into cid, yg from public.seasons where id = sid;
  for co in
    select coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') as cohort,
           count(*) as students
      from public.student_profiles p
     where p.college_id = cid
       and p.passing_out_year is not distinct from yg
       and p.onboarding_status <> 'blocked'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     group by 1
     order by 1
  loop
    n := co.students;
    -- free seats in the section's squads first, emptiest squad first, up to eleven
    filled := 0;
    for stu in
      select p.id
        from public.student_profiles p
       where p.college_id = cid
         and p.passing_out_year is not distinct from yg
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
         and s.college_id = cid and not s.is_locked
         and coalesce(s.cohort, 'GENERAL') = co.cohort
         and (select count(*) from public.squad_members m
               where m.squad_id = s.id and m.left_at is null) < least(11, s.max_members)
       order by (select count(*) from public.squad_members m
                  where m.squad_id = s.id and m.left_at is null), s.created_at
       limit 1;
      exit when target is null;
      begin
        insert into public.squad_members (squad_id, student_id, joined_at)
        values (target, stu.id, now());
      exception when unique_violation then
        continue;
      end;
      placed := placed + 1;
      filled := filled + 1;
    end loop;
    n := n - filled;
    -- whole elevens only; fewer than eleven wait in Reserve
    k := n / 11;
    continue when k < 1;
    select t.theme into theme
      from public.squad_name_themes t
     where t.branch = split_part(co.cohort, '-', 1)
       and (t.college_id = cid or t.college_id is null)
     order by t.college_id nulls last
     limit 1;
    if theme is null then
      select t.theme into theme
        from public.squad_name_themes t
       where t.branch = '*' and (t.college_id = cid or t.college_id is null)
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
      values (co.cohort || ' ' || theme || ' ' || i, cid, sid, co.cohort, 12)
      returning id into new_id;
      squad_ids := squad_ids || new_id;
      created := created + 1;
    end loop;
    pos := 0;
    for stu in
      select p.id
        from public.student_profiles p
       where p.college_id = cid
         and p.passing_out_year is not distinct from yg
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
  -- league fixtures straight away: the whole league, or the weeks left for squads that joined late
  if public.season_phase(sid) = 'league' then
    if not exists (select 1 from public.squad_matches where season_id = sid and stage = 'league') then
      if exists (select 1 from public.squads where season_id = sid and archived_at is null
                  group by coalesce(cohort, 'GENERAL') having count(*) >= 2) then
        perform public.generate_cohort_league(sid, false);
      end if;
    elsif exists (select 1 from public.squads q
                   where q.season_id = sid and q.archived_at is null
                     and exists (select 1 from public.squads o where o.season_id = sid and o.archived_at is null
                                  and o.id <> q.id and coalesce(o.cohort, 'GENERAL') = coalesce(q.cohort, 'GENERAL'))
                     and not exists (select 1 from public.squad_matches m
                                      where m.season_id = sid and m.stage = 'league'
                                        and (m.home_squad = q.id or m.away_squad = q.id))) then
      perform public.extend_fixtures(sid);
    end if;
  end if;
  return jsonb_build_object('squads_created', created, 'students_placed', placed);
end $fn$;
revoke all on function public.form_squads_in(uuid) from public, anon, authenticated;
grant execute on function public.form_squads_in(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.form_squads(_college_id uuid, _season_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  g record; sid uuid; r jsonb; created integer := 0; placed integer := 0;
  waiting integer := 0; next_at timestamptz; last record;
begin
  perform pg_advisory_xact_lock(hashtext('prooflab.squads'), hashtext(_college_id::text));
  -- 184: every year group with someone waiting gets its own season (or the one already running)
  for g in
    select s.year_group as yg from public.seasons s where s.id = _season_id
    union
    select distinct p.passing_out_year from public.student_profiles p
     where _season_id is null and p.college_id = _college_id and p.onboarding_status <> 'blocked'
       and not exists (select 1 from public.squad_members m where m.student_id = p.id and m.left_at is null)
  loop
    sid := coalesce(_season_id, public.ensure_season(_college_id, g.yg));
    if sid is null then
      -- the days off between seasons: they wait, and are seated when the next season opens
      waiting := waiting + (select count(*) from public.student_profiles p
                             where p.college_id = _college_id and p.passing_out_year is not distinct from g.yg
                               and p.onboarding_status <> 'blocked'
                               and not exists (select 1 from public.squad_members m
                                                where m.student_id = p.id and m.left_at is null));
      select * into last from public.seasons
       where college_id = _college_id and year_group is not distinct from g.yg and status = 'complete'
       order by completed_at desc nulls last limit 1;
      next_at := least(coalesce(next_at, 'infinity'), last.completed_at + public.season_gap(last.id));
      continue;
    end if;
    r := public.form_squads_in(sid);
    created := created + (r->>'squads_created')::int;
    placed  := placed  + (r->>'students_placed')::int;
  end loop;
  perform public.write_audit('SQUADS_FORMED', 'squads', _college_id, null,
    jsonb_build_object('squads_created', created, 'students_placed', placed, 'between_seasons', waiting), _college_id);
  return jsonb_build_object(
    'ok', true, 'squads_created', created, 'students_placed', placed,
    'cohorts', (select count(distinct q.cohort) from public.squads q join public.seasons s on s.id = q.season_id
                 where s.college_id = _college_id and s.is_current and q.archived_at is null),
    'between_seasons', waiting, 'next_season_at', next_at,
    'reserve', (select count(*) from public.student_profiles p
                 where p.college_id = _college_id
                   and p.onboarding_status <> 'blocked'
                   and not exists (select 1 from public.squad_members m
                                    where m.student_id = p.id and m.left_at is null)));
end $function$;

-- The nightly job: every college with students (this is also what opens a season after its days off).
CREATE OR REPLACE FUNCTION public.form_all_colleges()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record; made integer := 0; placed integer := 0; failed integer := 0; first_error text; r jsonb;
begin
  for c in
    select distinct p.college_id from public.student_profiles p where p.college_id is not null
  loop
    begin
      r := public.form_squads(c.college_id);
      made   := made   + coalesce((r->>'squads_created')::int, 0);
      placed := placed + coalesce((r->>'students_placed')::int, 0);
    exception when others then
      failed := failed + 1;
      first_error := coalesce(first_error, c.college_id || ': ' || left(sqlerrm, 200));
      raise notice 'squad formation failed for %: %', c.college_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'squads_created', made, 'students_placed', placed,
                            'colleges_failed', failed, 'first_error', first_error,
                            'status', case when failed > 0 then 'partial_failure' else 'success' end,
                            'ran_at', now());
end $function$;

-- Week 11: each section (or the college's pooled sections) ranks its squads and plays its semi-finals.
create or replace function public.generate_section_knockout(_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk integer; starts date; pool text[]; at timestamptz; b record; ids uuid[]; n integer; made integer := 0;
  brackets integer := 0;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'knockout';
  if wk is null then return jsonb_build_object('ok', true, 'fixtures', 0); end if;
  select starts_on, cross_sections into starts, pool from public.seasons where id = _season_id;
  at := case when public.test_fast_season(_season_id)
             then (select starts_at from public.season_week_bounds(_season_id, wk)) + interval '6 minutes'
             else (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours' end;
  perform public.recount_season(_season_id);
  update public.squads set bracket = null, seed = null, qualified = false where season_id = _season_id;
  delete from public.squad_matches where season_id = _season_id and stage in ('knockout', 'final');
  for b in
    select case when coalesce(cohort, 'GENERAL') = any(coalesce(pool, '{}')) then 'Cross-section'
                else coalesce(cohort, 'GENERAL') end as bracket
      from public.squads where season_id = _season_id and archived_at is null
     group by 1 order by 1
  loop
    with ranked as (
      select q.id, row_number() over (order by q.rank nulls last, q.points desc, q.name) as pos
        from public.squads q
       where q.season_id = _season_id and q.archived_at is null
         and (case when coalesce(q.cohort, 'GENERAL') = any(coalesce(pool, '{}')) then 'Cross-section'
                   else coalesce(q.cohort, 'GENERAL') end) = b.bracket)
    update public.squads q
       set bracket = b.bracket,
           seed = case when r.pos <= 4 then r.pos end,
           qualified = r.pos <= 4
      from ranked r where q.id = r.id;
    select array_agg(id order by seed) into ids
      from public.squads where season_id = _season_id and bracket = b.bracket and seed is not null;
    n := coalesce(array_length(ids, 1), 0);
    brackets := brackets + 1;
    if n >= 4 then
      insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort)
      values (_season_id, wk, ids[1], ids[4], at, 'scheduled', 'knockout', b.bracket),
             (_season_id, wk, ids[2], ids[3], at, 'scheduled', 'knockout', b.bracket);
      made := made + 2;
    elsif n = 3 then
      -- seed 1 waits in the final
      insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort)
      values (_season_id, wk, ids[2], ids[3], at, 'scheduled', 'knockout', b.bracket);
      made := made + 1;
    end if;
  end loop;
  perform public.write_audit('KNOCKOUT_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('week', wk, 'fixtures', made, 'brackets', brackets),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'week', wk, 'fixtures', made, 'brackets', brackets);
end $fn$;
revoke all on function public.generate_section_knockout(uuid) from public, anon, authenticated;
grant execute on function public.generate_section_knockout(uuid) to service_role;

-- The squad that went through a knockout match (a tie goes to the higher seed).
create or replace function public.match_winner(_match_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(m.winner_squad, case
           when coalesce(m.home_points, 0) > coalesce(m.away_points, 0) then m.home_squad
           when coalesce(m.away_points, 0) > coalesce(m.home_points, 0) then m.away_squad
           else (select q.id from public.squads q where q.id in (m.home_squad, m.away_squad)
                  order by q.seed nulls last, q.points desc limit 1) end)
    from public.squad_matches m where m.id = _match_id;
$fn$;
revoke all on function public.match_winner(uuid) from public, anon, authenticated;
grant execute on function public.match_winner(uuid) to service_role;

-- Week 12: one final in every bracket.
create or replace function public.generate_section_finals(_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk integer; starts date; at timestamptz; b record; a uuid; c uuid; n integer; made integer := 0;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'final';
  if wk is null then return jsonb_build_object('ok', false, 'note', 'no final week'); end if;
  select starts_on into starts from public.seasons where id = _season_id;
  at := case when public.test_fast_season(_season_id)
             then (select starts_at from public.season_week_bounds(_season_id, wk)) + interval '6 minutes'
             else (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours' end;
  delete from public.squad_matches where season_id = _season_id and stage = 'final';
  for b in select distinct bracket from public.squads
            where season_id = _season_id and bracket is not null and archived_at is null order by 1 loop
    select count(*) into n from public.squads where season_id = _season_id and bracket = b.bracket and seed is not null;
    a := null; c := null;
    if n >= 4 then
      select public.match_winner(m.id) into a from public.squad_matches m
       where m.season_id = _season_id and m.stage = 'knockout' and m.cohort = b.bracket
         and exists (select 1 from public.squads q where q.id = m.home_squad and q.seed = 1);
      select public.match_winner(m.id) into c from public.squad_matches m
       where m.season_id = _season_id and m.stage = 'knockout' and m.cohort = b.bracket
         and exists (select 1 from public.squads q where q.id = m.home_squad and q.seed = 2);
    elsif n = 3 then
      select id into a from public.squads where season_id = _season_id and bracket = b.bracket and seed = 1;
      select public.match_winner(m.id) into c from public.squad_matches m
       where m.season_id = _season_id and m.stage = 'knockout' and m.cohort = b.bracket;
    elsif n = 2 then
      select id into a from public.squads where season_id = _season_id and bracket = b.bracket and seed = 1;
      select id into c from public.squads where season_id = _season_id and bracket = b.bracket and seed = 2;
    end if;
    continue when a is null or c is null or a = c;
    insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort)
    values (_season_id, wk, a, c, at, 'scheduled', 'final', b.bracket);
    made := made + 1;
  end loop;
  perform public.write_audit('FINAL_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('week', wk, 'finals', made), (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'week', wk, 'finals', made);
end $fn$;
revoke all on function public.generate_section_finals(uuid) from public, anon, authenticated;
grant execute on function public.generate_section_finals(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.advance_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare wk integer; ph text; did text := 'nothing'; v integer;
begin
  wk := public.season_week(_season_id);
  ph := public.season_phase(_season_id, wk);
  select plan_version into v from public.seasons where id = _season_id;
  if ph = 'league' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'league') then
      perform public.generate_cohort_league(_season_id, false);
      did := 'league fixtures created';
    end if;
  elsif ph = 'championship' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'championship') then
      perform public.qualify_squads(_season_id);
      perform public.generate_championship(_season_id);
      did := 'qualification decided and championship created';
    end if;
  elsif ph = 'seeding' then
    if exists (select 1 from public.squads where season_id = _season_id and qualified) then
      perform public.seed_championship(_season_id);
      did := 'championship seeded';
    end if;
  elsif ph = 'knockout' and v = 2 then
    -- 184: brackets are decided once (a 2-squad section has no semi-final, so check the brackets, not matches)
    if not exists (select 1 from public.squads where season_id = _season_id and bracket is not null) then
      perform public.generate_section_knockout(_season_id);
      did := 'section semi-finals created';
    end if;
  elsif ph = 'knockout' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'knockout') then
      perform public.generate_knockout(_season_id);
      did := 'knockout created';
    end if;
  elsif ph = 'final' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'final') then
      if v = 2 then
        if not exists (select 1 from public.squads where season_id = _season_id and bracket is not null) then
          perform public.generate_section_knockout(_season_id);  -- the knockout week was missed
        end if;
        perform public.generate_section_finals(_season_id);
        did := 'section finals created';
      else
        perform public.generate_final(_season_id);
        did := 'final created';
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'week', wk, 'phase', ph, 'did', did);
end $function$;

CREATE OR REPLACE FUNCTION public.close_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  podium uuid[]; names text[]; how text; v integer; b record; brackets integer := 0;
  fin record; champ uuid; runner uuid; third uuid;
begin
  select plan_version into v from public.seasons where id = _season_id;
  if v = 2 then
    -- 184: a champion in every bracket that played its final and had a league
    delete from public.season_champions where season_id = _season_id;
    for b in select distinct bracket from public.squads where season_id = _season_id and bracket is not null loop
      select * into fin from public.squad_matches
       where season_id = _season_id and stage = 'final' and cohort = b.bracket and status in ('played', 'no_activity')
       order by scheduled_at desc limit 1;
      continue when fin.id is null;
      continue when not exists (
        select 1 from public.squad_matches m join public.squads q on q.id in (m.home_squad, m.away_squad)
         where m.season_id = _season_id and m.stage = 'league' and m.status = 'played' and q.bracket = b.bracket);
      champ := public.match_winner(fin.id);
      runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;
      third := null;
      select q.id into third
        from public.squad_matches m
        join public.squads q on q.id in (m.home_squad, m.away_squad)
       where m.season_id = _season_id and m.stage = 'knockout' and m.cohort = b.bracket
         and m.status in ('played', 'no_activity') and q.id not in (champ, runner)
       order by q.seed nulls last limit 1;
      insert into public.season_champions (season_id, bracket, champion_squad_id, runner_up_squad_id, third_squad_id)
      values (_season_id, b.bracket, champ, runner, third);
      brackets := brackets + 1;
    end loop;
    if brackets = 1 then
      select array[champion_squad_id, runner_up_squad_id, third_squad_id] into podium
        from public.season_champions where season_id = _season_id;
    end if;
    how := case when brackets > 0 then 'final' else 'no_league' end;
  else
    select * into fin from public.squad_matches
     where season_id = _season_id and stage = 'final' and status in ('played', 'no_activity')
     order by scheduled_at desc limit 1;
    if fin.id is not null then
      champ := coalesce(fin.winner_squad, case
        when coalesce(fin.home_points, 0) > coalesce(fin.away_points, 0) then fin.home_squad
        when coalesce(fin.away_points, 0) > coalesce(fin.home_points, 0) then fin.away_squad
        else (select id from public.squads where id in (fin.home_squad, fin.away_squad)
               order by seed nulls last, points desc limit 1)
      end);
      runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;
      select q.id into third
        from public.squad_matches m
        join public.squads q on q.id in (m.home_squad, m.away_squad)
       where m.season_id = _season_id and m.stage = 'knockout' and m.status in ('played', 'no_activity')
         and q.id not in (champ, runner)
       order by q.seed nulls last, q.points desc
       limit 1;
      podium := array[champ, runner, third];
      how := 'final';
    elsif exists (select 1 from public.squad_matches
                   where season_id = _season_id and stage = 'league' and status = 'played') then
      select array_agg(id order by points desc nulls last, name)
        into podium
        from public.squads where season_id = _season_id;
      how := 'points';
    else
      podium := null;
      how := 'no_league';
    end if;
  end if;
  select array_agg(q.name order by p.i) into names
    from unnest(podium) with ordinality p(id, i) join public.squads q on q.id = p.id;
  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  update public.squad_members m set left_at = now()
    from public.squads q
   where q.id = m.squad_id and q.season_id = _season_id and m.left_at is null;
  update public.squads set archived_at = now()
   where season_id = _season_id and archived_at is null;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', how, 'brackets', brackets),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', how, 'brackets', brackets,
                            'champions', (select coalesce(jsonb_agg(jsonb_build_object(
                                            'bracket', c.bracket, 'champion', q.name) order by c.bracket), '[]'::jsonb)
                                            from public.season_champions c join public.squads q on q.id = c.champion_squad_id
                                           where c.season_id = _season_id));
end $function$;

-- Which year group the signed-in person is looking at: a student their own; a college the one it picked
-- (0 = students with no year set), else the year group with the most squads running.
create or replace function public.my_year_group()
returns integer language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when public.my_college_id() is not null then
    coalesce(
      (select c.viewing_year_group from public.colleges c
        where c.id = public.my_college_id()
          and exists (select 1 from public.seasons s where s.college_id = c.id
                       and coalesce(s.year_group, 0) = c.viewing_year_group)),
      (select coalesce(s.year_group, 0) from public.seasons s
        where s.college_id = public.my_college_id()
        order by s.is_current desc,
                 (select count(*) from public.squads q where q.season_id = s.id and q.archived_at is null) desc,
                 s.created_at desc
        limit 1))
  else
    coalesce((select coalesce(s.year_group, 0)
                from public.squad_members m join public.squads q on q.id = m.squad_id
                join public.seasons s on s.id = q.season_id
               where m.student_id = (select auth.uid()) and m.left_at is null and s.is_current
               limit 1),
             (select coalesce(p.passing_out_year, 0) from public.student_profiles p where p.id = (select auth.uid())))
  end;
$fn$;
revoke all on function public.my_year_group() from public, anon;
grant execute on function public.my_year_group() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_season_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.id
    from public.seasons s
   where s.is_current
     and s.college_id = coalesce(
           public.my_college_id(),
           (select p.college_id from public.student_profiles p where p.id = (select auth.uid())))
     and coalesce(s.year_group, 0) = coalesce(public.my_year_group(), 0)
   order by s.starts_on desc
   limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.my_last_season_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.id from public.seasons s
   where s.college_id = coalesce(public.my_college_id(),
                                 (select p.college_id from public.student_profiles p where p.id = (select auth.uid())))
     and coalesce(s.year_group, 0) = coalesce(public.my_year_group(), 0)
   order by s.starts_on desc, s.created_at desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.my_season_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid := public.my_season_id(); s record; wk integer; last record; nxt timestamptz; yg integer := public.my_year_group();
begin
  if sid is null then
    select x.* into last from public.seasons x where x.id = public.my_last_season_id();
    if last.id is null or last.status is distinct from 'complete' then
      return jsonb_build_object('season', null, 'state', 'none', 'year_group', yg,
                                'year_group_label', coalesce(public.year_group_label(nullif(yg, 0)), 'No year set'));
    end if;
    -- 184: the next season opens after the days off, at the next morning squad job (05:35 IST)
    nxt := last.completed_at + public.season_gap(last.id);
    if not public.test_fast_season(last.id) then
      nxt := (date_trunc('day', nxt at time zone 'Asia/Kolkata') + interval '5 hours 35 minutes') at time zone 'Asia/Kolkata';
      if nxt < last.completed_at + public.season_gap(last.id) then nxt := nxt + interval '1 day'; end if;
    end if;
    return jsonb_build_object(
      'season', null,
      'state', 'complete',
      'year_group', yg,
      'year_group_label', coalesce(public.year_group_label(nullif(yg, 0)), 'No year set'),
      'last_season', jsonb_build_object(
        'id', last.id, 'name', last.name, 'completed_at', last.completed_at,
        'champion',  (select q.name from public.squads q where q.id = last.champion_squad_id),
        'runner_up', (select q.name from public.squads q where q.id = last.runner_up_squad_id),
        'third',     (select q.name from public.squads q where q.id = last.third_squad_id),
        'champions', (select coalesce(jsonb_agg(jsonb_build_object('bracket', c.bracket, 'champion', q.name)
                                                order by c.bracket), '[]'::jsonb)
                        from public.season_champions c join public.squads q on q.id = c.champion_squad_id
                       where c.season_id = last.id)),
      'fresh_squads_next', last.fresh_squads_next,
      'next_season_name', 'Season ' || ((select count(*) from public.seasons x
                                          where x.college_id = last.college_id
                                            and x.year_group is not distinct from last.year_group) + 1),
      'next_season_at', nxt);
  end if;
  select * into s from public.seasons where id = sid;
  wk := public.season_week(sid);
  return jsonb_build_object(
    'state',            'active',
    'season_id',        sid,
    'name',             s.name,
    'status',           s.status,
    'starts_on',        s.starts_on,
    'planned_weeks',    s.planned_weeks,
    'plan_version',     s.plan_version,
    'year_group',       yg,
    'year_group_label', coalesce(public.year_group_label(s.year_group), 'No year set'),
    'cross_sections',   s.cross_sections,
    'fresh_squads_next', s.fresh_squads_next,
    'week',             wk,
    'phase',            public.season_phase(sid, wk),
    'label',            (select label from public.season_plan(sid) where week = wk),
    'league_last_week', public.season_league_last_week(sid),
    'plan',             (select jsonb_agg(jsonb_build_object('week', week, 'phase', phase, 'label', label)
                                          order by week) from public.season_plan(sid)),
    'squads',           (select count(*) from public.squads
                          where season_id = sid and archived_at is null),
    'cohorts',          (select count(distinct coalesce(cohort, 'GENERAL')) from public.squads
                          where season_id = sid and archived_at is null),
    'qualified',        (select count(*) from public.squads
                          where season_id = sid and qualified),
    'decided',          exists (select 1 from public.squads
                                 where season_id = sid and qualified is not null)
  );
end $function$;

-- College screens: the year groups to choose from.
create or replace function public.tpo_year_groups()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  with cid as (select public.my_college_id() as id),
  g as (
    select coalesce(p.passing_out_year, 0) as yg from public.student_profiles p, cid where p.college_id = cid.id
    union
    select coalesce(s.year_group, 0) from public.seasons s, cid where s.college_id = cid.id and s.is_current)
  select coalesce(jsonb_agg(jsonb_build_object(
           'year_group', g.yg,
           'label', coalesce(public.year_group_label(nullif(g.yg, 0)), 'No year set'),
           'students', (select count(*) from public.student_profiles p, cid
                         where p.college_id = cid.id and coalesce(p.passing_out_year, 0) = g.yg),
           'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'week', public.season_week(s.id),
                                                'phase', public.season_phase(s.id))
                        from public.seasons s, cid
                       where s.college_id = cid.id and s.is_current and coalesce(s.year_group, 0) = g.yg limit 1),
           'selected', g.yg = coalesce(public.my_year_group(), -1))
         order by g.yg = 0, g.yg desc), '[]'::jsonb)
    from g;
$fn$;
revoke all on function public.tpo_year_groups() from public, anon;
grant execute on function public.tpo_year_groups() to authenticated, service_role;

create or replace function public.tpo_pick_year_group(_year_group integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id();
begin
  if cid is null then raise exception 'only a college can choose its year group'; end if;
  update public.colleges set viewing_year_group = coalesce(_year_group, 0) where id = cid;
  return jsonb_build_object('ok', true, 'year_group', public.my_year_group());
end $fn$;
revoke all on function public.tpo_pick_year_group(integer) from public, anon;
grant execute on function public.tpo_pick_year_group(integer) to authenticated, service_role;

-- College settings for the season it is looking at: pooled sections (before the semi-finals only) and
-- "Make fresh squads" for the next season (can be undone until the next season opens).
create or replace function public.tpo_season_options(_cross_sections text[] default null, _fresh_squads_next boolean default null,
                                                      _set_cross boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id(); sid uuid; s record; secs text[]; known text[];
begin
  if cid is null then raise exception 'only a college can change its season'; end if;
  sid := coalesce(public.my_season_id(), public.my_last_season_id());
  select * into s from public.seasons where id = sid and college_id = cid;
  if s.id is null then raise exception 'no season for this year group yet'; end if;
  if _set_cross then
    if not s.is_current or s.plan_version <> 2 or public.season_phase(sid) <> 'league' then
      raise exception 'sections can be pooled only before the semi-finals';
    end if;
    select array_agg(distinct x order by x) into secs
      from unnest(coalesce(_cross_sections, '{}')) x where nullif(trim(x), '') is not null;
    select array_agg(distinct coalesce(cohort, 'GENERAL')) into known
      from public.squads where season_id = sid and archived_at is null;
    if secs is not null and not (secs <@ coalesce(known, '{}')) then
      raise exception 'only sections that have squads this season can be pooled';
    end if;
    if secs is not null and array_length(secs, 1) < 2 then
      raise exception 'pick at least two sections to pool';
    end if;
    update public.seasons set cross_sections = secs where id = sid;
  end if;
  if _fresh_squads_next is not null then
    if exists (select 1 from public.seasons x where x.college_id = cid and x.created_at > s.created_at
                and x.year_group is not distinct from s.year_group) then
      raise exception 'the next season has already started';
    end if;
    update public.seasons set fresh_squads_next = _fresh_squads_next where id = sid;
  end if;
  select * into s from public.seasons where id = sid;
  perform public.write_audit('SEASON_OPTIONS', 'seasons', sid, null,
    jsonb_build_object('cross_sections', s.cross_sections, 'fresh_squads_next', s.fresh_squads_next), cid);
  return jsonb_build_object('ok', true, 'cross_sections', s.cross_sections, 'fresh_squads_next', s.fresh_squads_next);
end $fn$;
revoke all on function public.tpo_season_options(text[], boolean, boolean) from public, anon;
grant execute on function public.tpo_season_options(text[], boolean, boolean) to authenticated, service_role;

-- College functions that picked "the" current season now pick the year group the college is looking at.
CREATE OR REPLACE FUNCTION public.tpo_create_squad(_name text, _cohort text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cid uuid := public.my_college_id();
  sid uuid; new_id uuid; nm text := nullif(trim(coalesce(_name, '')), '');
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can create its own squads';
  end if;
  if nm is null then raise exception 'a squad needs a name'; end if;
  sid := coalesce(public.my_season_id(), public.ensure_season(cid, nullif(public.my_year_group(), 0)));
  if sid is null then raise exception 'no season is running for this year group'; end if;
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

CREATE OR REPLACE FUNCTION public.tpo_generate_fixtures(_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cid uuid := public.my_college_id(); sid uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can generate its own fixtures';
  end if;
  sid := public.my_season_id();
  if sid is null then raise exception 'no season is running for this college'; end if;
  return public.generate_cohort_league(sid, _force);
end $function$;

CREATE OR REPLACE FUNCTION public.tpo_run_week(_week integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cid uuid := public.my_college_id(); sid uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can score its own season'; end if;
  sid := public.my_season_id();
  if sid is null then raise exception 'no season is running'; end if;
  return public.run_squad_week(sid, _week);
end $function$;

-- tpo_home: the season card follows the chosen year group (text swap, the rest of the function is unchanged)
do $$
declare
  f constant regprocedure := 'public.tpo_home()'::regprocedure;
  old_rule constant text := E'   where s.college_id = cid and s.is_current order by s.starts_on desc limit 1;';
  def text := pg_get_functiondef(f);
begin
  if position(old_rule in def) = 0 then raise exception '184: tpo_home no longer has its season lookup'; end if;
  execute replace(def, old_rule, E'   where s.id = public.my_season_id();');
end $$;

-- Daily Lots stop in the days off between seasons (the roadmap stays open).
create or replace function public.in_season_gap(_student_id uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $fn$
  select last.completed_at + public.season_gap(last.id)
    from public.student_profiles p
    cross join lateral (
      select s.id, s.completed_at from public.seasons s
       where s.college_id = p.college_id and s.year_group is not distinct from p.passing_out_year
         and s.status = 'complete' and s.completed_at is not null
       order by s.completed_at desc limit 1) last
   where p.id = _student_id
     and not exists (select 1 from public.seasons c
                      where c.college_id = p.college_id and c.is_current
                        and c.year_group is not distinct from p.passing_out_year)
     and not exists (select 1 from public.squad_members m join public.squads q on q.id = m.squad_id
                      join public.seasons c on c.id = q.season_id
                     where m.student_id = p.id and m.left_at is null and c.is_current)
     and now() < last.completed_at + public.season_gap(last.id);
$fn$;
revoke all on function public.in_season_gap(uuid) from public, anon, authenticated;
grant execute on function public.in_season_gap(uuid) to service_role;

do $$
declare
  f constant regprocedure := 'public.create_lot_for(uuid,date)'::regprocedure;
  anchor constant text := E'  pick := public.next_lot_pick(_student_id, d);';
  gap_rule constant text :=
       E'  -- 184: no Daily Lot in the days off between two seasons (roadmap only)\n'
    || E'  if public.in_season_gap(_student_id) is not null then\n'
    || E'    return jsonb_build_object(''ok'', true, ''task_id'', null, ''created'', false,\n'
    || E'      ''reason'', ''between seasons'', ''next_season_at'', public.in_season_gap(_student_id), ''needs_writer'', false);\n'
    || E'  end if;\n';
  def text := pg_get_functiondef(f);
begin
  if position(anchor in def) = 0 then raise exception '184: create_lot_for no longer has its pick line'; end if;
  execute replace(def, anchor, gap_rule || anchor);
end $$;

-- Admin: every running season, one row per year group.
CREATE OR REPLACE FUNCTION public.admin_squads(_college_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if _college_id is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object('college_id', c.id, 'college', c.name, 'season_starts', s.starts_on,
               'season', s.name, 'year_group', s.year_group,
               'year_group_label', coalesce(public.year_group_label(s.year_group), 'No year set'),
               'week', public.season_week(s.id), 'phase', public.season_phase(s.id),
               'squads', (select count(*) from public.squads q where q.season_id = s.id and q.archived_at is null),
               'swaps', (select count(*) from public.squad_swaps w where w.season_id = s.id and w.status = 'done'))
               order by c.name, s.year_group nulls last)
        from public.seasons s join public.colleges c on c.id = s.college_id
       where s.is_current), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'name', q.name, 'cohort', q.cohort, 'points', q.points, 'rank', q.rank,
             'max_members', q.max_members, 'is_locked', q.is_locked, 'code', public.squad_code_for(q.id),
             'swap_closes', public.squad_swap_closes(q.id),
             'year_group_label', coalesce(public.year_group_label(s.year_group), 'No year set'),
             'members', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'contribution', m.contribution,
                                                                      'joined_at', m.joined_at) order by p.full_name)
                                    from public.squad_members m join public.student_profiles p on p.id = m.student_id
                                   where m.squad_id = q.id and m.left_at is null), '[]'::jsonb))
           order by s.year_group nulls last, q.cohort nulls last, q.points desc, q.name)
      from public.squads q join public.seasons s on s.id = q.season_id
     where q.college_id = _college_id and s.is_current and q.archived_at is null), '[]'::jsonb);
end $function$;

-- self-check
do $$
begin
  if (select count(*) from public.season_plan(gen_random_uuid())) <> 0 then raise exception '184: plan for no season'; end if;
  if position('between seasons' in pg_get_functiondef('public.create_lot_for(uuid,date)'::regprocedure)) = 0 then
    raise exception '184: create_lot_for has no gap rule';
  end if;
  if position('my_season_id()' in pg_get_functiondef('public.tpo_home()'::regprocedure)) = 0 then
    raise exception '184: tpo_home was not updated';
  end if;
  if position('league_over' in pg_get_functiondef('public.form_squads(uuid,uuid)'::regprocedure)) > 0 then
    raise exception '184: form_squads still has the week-1 rule';
  end if;
  if exists (select 1 from public.seasons where is_current group by college_id, coalesce(year_group, 0) having count(*) > 1) then
    raise exception '184: two running seasons for one year group';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
