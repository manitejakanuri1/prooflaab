-- Week-1 joining check (TEST only, migration 179): a new student gets a squad seat only in week 1. ROLLS BACK.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/join_week_one_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (n int, what text, ok boolean);
do $$
declare col uuid; sid uuid; res jsonb; stu uuid;
begin
  perform set_config('app.system_write', 'on', true);
  select id into col from public.colleges where name = 'PRAGATI';
  select p.id into stu from public.student_profiles p where p.college_id = col and p.cohort = 'CSE-A' limit 1;

  -- week 5, squads already exist: nobody new is seated
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current)
  values ('check week 5', current_date - 30, current_date + 50, col, 'active', false) returning id into sid;
  update public.seasons set created_at = now() - interval '50 minutes' where id = sid;   -- TEST fast seasons count 10-minute weeks
  insert into public.squads (name, college_id, season_id, cohort, max_members) values ('W1', col, sid, 'CSE-A', 12);
  update public.squad_members set left_at = now() where student_id = stu and left_at is null;
  res := public.form_squads(col, sid);
  insert into r values (1, 'Week ' || public.season_week(sid) || ', squads exist: nobody is seated',
    (res->>'league_over')::boolean and (res->>'students_placed')::int = 0
    and not exists (select 1 from public.squad_members where student_id = stu and left_at is null));

  -- week 5, but the season has no squads yet: the first squads are still made
  delete from public.squads where season_id = sid;
  res := public.form_squads(col, sid);
  insert into r values (2, 'Week 5, no squads yet: first squads are formed', (res->>'students_placed')::int > 0);

  -- week 1: a student without a squad is seated
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current)
  values ('check week 1', current_date, current_date + 80, col, 'active', false) returning id into sid;
  insert into public.squads (name, college_id, season_id, cohort, max_members) values ('W2', col, sid, 'CSE-A', 12);
  update public.squad_members set left_at = now() where left_at is null
     and squad_id in (select id from public.squads where college_id = col and season_id <> sid);
  res := public.form_squads(col, sid);
  insert into r values (3, 'Week ' || public.season_week(sid) || ': students without a squad are seated',
    (res->>'students_placed')::int > 0 and res->>'league_over' is null);
end $$;
select n, what, case when ok then 'PASS' else 'FAIL' end as result from r order by n;
select count(*) filter (where ok) || ' of ' || count(*) || ' pass' as total from r;
rollback;
