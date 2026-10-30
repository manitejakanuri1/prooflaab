-- Same squads all school year (TEST only, migration 182): close a season, open the next, squads come back. ROLLS BACK.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/same_squads_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (n int, what text, ok boolean);
do $$
declare col uuid; s1 uuid; s2 uuid; s3 uuid; qa uuid; qb uuid; stu uuid[]; mover uuid; blocked uuid; n int;
begin
  perform set_config('app.system_write', 'on', true);
  select id into col from public.colleges where name = 'PRAGATI';
  update public.seasons set is_current = false where college_id = col;
  update public.squad_members m set left_at = now() from public.student_profiles p
   where p.id = m.student_id and p.college_id = col and m.left_at is null;

  -- season 1 in this school year with two CSE-A squads of 3 students each
  insert into public.seasons (name, starts_on, ends_on, college_id, status, is_current, planned_weeks)
  values ('chk S1', current_date - 90, current_date - 6, col, 'active', true, 12) returning id into s1;
  insert into public.squads (name, college_id, season_id, cohort, max_members, points) values ('Alpha', col, s1, 'CSE-A', 12, 40) returning id into qa;
  insert into public.squads (name, college_id, season_id, cohort, max_members, points) values ('Beta',  col, s1, 'CSE-A', 12, 30) returning id into qb;
  select array_agg(id order by id) into stu from (select id from public.student_profiles where college_id = col and cohort = 'CSE-A' order by id limit 6) x;
  insert into public.squad_members (squad_id, student_id, role, joined_at) select qa, unnest(stu[1:3]), 'member', now() - interval '80 days';
  insert into public.squad_members (squad_id, student_id, role, joined_at) select qb, unnest(stu[4:6]), 'member', now() - interval '80 days';
  mover := stu[2]; blocked := stu[5];

  perform public.close_season(s1);
  -- between seasons: one student moves section, one is blocked
  update public.student_profiles set cohort = 'CSE-B' where id = mover;
  update public.student_profiles set onboarding_status = 'blocked' where id = blocked;

  s2 := public.ensure_season(col);
  insert into r values (1, 'New season has the same squads (Alpha, Beta)',
    (select array_agg(name order by name) from public.squads where season_id = s2) = array['Alpha','Beta']);
  insert into r values (2, 'Points start from 0',
    not exists (select 1 from public.squads where season_id = s2 and coalesce(points,0) <> 0));
  select count(*) into n from public.squad_members m join public.squads q on q.id = m.squad_id
   where q.season_id = s2 and q.name = 'Alpha' and m.left_at is null;
  insert into r values (3, 'Alpha keeps its 2 members who stayed (the one who moved section does not come)', n = 2
    and not exists (select 1 from public.squad_members m join public.squads q on q.id = m.squad_id where q.season_id = s2 and m.student_id = mover));
  insert into r values (4, 'A blocked student is not carried',
    not exists (select 1 from public.squad_members m join public.squads q on q.id = m.squad_id where q.season_id = s2 and m.student_id = blocked));
  insert into r values (5, 'Last season keeps its own squads and points (history untouched)',
    (select sum(points) from public.squads where season_id = s1) = 70);

  -- a new school year: nothing carries
  perform public.close_season(s2);
  update public.seasons set starts_on = make_date(public.school_year(current_date) - 1, 9, 1) where id = s2;
  -- one test transaction gives both closes the same time; in real use season 1 closed months earlier
  update public.seasons set completed_at = completed_at - interval '90 days' where id = s1;
  s3 := public.ensure_season(col);
  insert into r values (6, 'New school year: no squads carried', not exists (select 1 from public.squads where season_id = s3));
end $$;
select n, what, case when ok then 'PASS' else 'FAIL' end as result from r order by n;
select count(*) filter (where ok) || ' of ' || count(*) || ' pass' as total from r;
rollback;
