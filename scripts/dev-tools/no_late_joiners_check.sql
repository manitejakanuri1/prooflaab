-- MF-122 check (TEST only, migration 175): after the league, form_squads seats nobody. ROLLS BACK.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/no_late_joiners_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (n int, what text, ok boolean);
do $$
declare col uuid; sid uuid; q1 uuid; q2 uuid; res jsonb; stu uuid;
begin
  perform set_config('app.system_write', 'on', true);
  select id into col from public.colleges where name = 'PRAGATI';
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current)
  values ('check season', current_date - 30, current_date + 30, col, 'active', false) returning id into sid;
  insert into public.squads (name, college_id, season_id, cohort, max_members) values ('K1', col, sid, 'CSE-A', 12) returning id into q1;
  insert into public.squads (name, college_id, season_id, cohort, max_members) values ('K2', col, sid, 'CSE-B', 12) returning id into q2;
  -- one PRAGATI student with no squad
  select p.id into stu from public.student_profiles p where p.college_id = col and p.cohort = 'CSE-A' limit 1;
  update public.squad_members set left_at = now() where student_id = stu and left_at is null;

  insert into public.squad_matches (season_id, stage, status, home_squad, away_squad, scheduled_at, round_number)
  values (sid, 'knockout', 'scheduled', q1, q2, now() + interval '1 day', 9);
  res := public.form_squads(col, sid);
  insert into r values (1, 'Knockout running: nobody is seated', (res->>'league_over')::boolean and (res->>'students_placed')::int = 0
                          and not exists (select 1 from public.squad_members where student_id = stu and left_at is null));

  delete from public.squad_matches where season_id = sid;
  res := public.form_squads(col, sid);
  insert into r values (2, 'League still running: students without a squad are seated', (res->>'students_placed')::int > 0 and res->>'league_over' is null);
end $$;
select n, what, case when ok then 'PASS' else 'FAIL' end as result from r order by n;
select count(*) filter (where ok) || ' of ' || count(*) || ' pass' as total from r;
rollback;
