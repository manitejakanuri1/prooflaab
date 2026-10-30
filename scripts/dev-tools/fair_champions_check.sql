-- MF-053 / MF-049 / MF-056 check (TEST only, migrations 173-174). ROLLS BACK.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/fair_champions_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (n int, what text, ok boolean);
do $$
declare col uuid; sid uuid; q1 uuid; q2 uuid; res jsonb; demo_visible int;
begin
  perform set_config('app.system_write', 'on', true);
  -- a fresh season with one squad and no league match
  select id into col from public.colleges where name = 'PRAGATI';
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current)
  values ('check season', current_date - 30, current_date, col, 'active', false) returning id into sid;
  insert into public.squads (name, college_id, season_id, cohort, max_members) values ('Only Squad', col, sid, 'X', 12) returning id into q1;
  res := public.close_season(sid);
  insert into r values (1, 'One squad, no league: no champion', res->>'champion' is null and res->>'decided_by' = 'no_league');

  -- two qualified squads level on points and wins: head-to-head decides, not the name
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current)
  values ('check season 2', current_date - 30, current_date, col, 'active', false) returning id into sid;
  insert into public.squads (name, college_id, season_id, cohort, max_members, qualified, points) values ('A Squad', col, sid, 'X', 12, true, 10) returning id into q1;
  insert into public.squads (name, college_id, season_id, cohort, max_members, qualified, points) values ('B Squad', col, sid, 'Y', 12, true, 10) returning id into q2;
  insert into public.squad_matches (season_id, stage, status, home_squad, away_squad, home_points, away_points, scheduled_at, round_number)
  values (sid, 'championship', 'played', q1, q2, 10, 12, now() - interval '2 days', 1),
         (sid, 'championship', 'played', q2, q1, 8, 10, now() - interval '1 day', 2);
  perform public.seed_championship(sid);
  -- level: 20 points and 1 win each; head-to-head points equal too (20 v 20) -> season points equal -> name.
  -- make B better on season points: B must be seed 1 although "A" comes first by name.
  update public.squads set points = 11 where id = q2;
  perform public.seed_championship(sid);
  insert into r values (2, 'Tie on points and wins: season points beat the name', (select seed from public.squads where id = q2) = 1);

  select count(*) into demo_visible from public.student_profiles p
   where public.is_demo_student(p.id) and public.student_is_discoverable(p.id);
  insert into r values (3, 'No demo student is visible to companies', demo_visible = 0);
end $$;
select n, what, case when ok then 'PASS' else 'FAIL' end as result from r order by n;
select count(*) filter (where ok) || ' of ' || count(*) || ' pass' as total from r;
rollback;
