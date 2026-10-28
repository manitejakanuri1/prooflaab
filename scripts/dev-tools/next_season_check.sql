-- MF-016 check (TEST only): closing a season frees its students, and the morning job opens the next season
-- and seats them again (11 per squad, the rest wait in Reserve).
-- Runs on PRAGATI Season 1 inside one transaction and ROLLS BACK: nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/next_season_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (k text, v bigint);
create temp table s as select id, college_id from public.seasons where id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8';
-- Put Season 1 back to running, with its squads and members as they are.
update public.seasons set status = 'active', is_current = true, completed_at = null where id = (select id from s);
insert into r select 'before close: students in a squad', count(*) from public.squad_members m
  join public.squads q on q.id = m.squad_id where q.season_id = (select id from s) and m.left_at is null;

select public.close_season((select id from s));
insert into r select 'after close: students still held by Season 1 (want 0)', count(*) from public.squad_members m
  join public.squads q on q.id = m.squad_id where q.season_id = (select id from s) and m.left_at is null;
insert into r select 'after close: Season 1 squads not archived (want 0)', count(*) from public.squads
 where season_id = (select id from s) and archived_at is null;

select public.form_all_colleges();
insert into r select 'next season opened (want 1)', count(*) from public.seasons
 where college_id = (select college_id from s) and is_current and status = 'active';
insert into r select 'next season: students seated (want = before, minus extras over 11)', count(*) from public.squad_members m
  join public.squads q on q.id = m.squad_id join public.seasons n on n.id = q.season_id
 where n.college_id = (select college_id from s) and n.is_current and m.left_at is null;
insert into r select 'next season: biggest squad (want <= 11)', coalesce(max(c), 0) from (
  select count(*) c from public.squad_members m join public.squads q on q.id = m.squad_id join public.seasons n on n.id = q.season_id
   where n.college_id = (select college_id from s) and n.is_current and m.left_at is null group by q.id) x;
-- Read the finished season as the PRAGATI college account would.
select set_config('request.jwt.claims', json_build_object('sub', (select c.user_id from public.colleges c where c.id = (select college_id from s)), 'role', 'authenticated')::text, true);
insert into r select 'finished season leaderboard rows with a squad name', count(*) from public.season_leaderboard('overall', (select id from s), 100) l
 where l.squad_name is not null;

select k as check, v as value from r;
rollback;
