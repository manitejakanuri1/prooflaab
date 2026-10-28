-- MF-004 check (TEST only): league fixtures must stay inside league weeks and inside a section.
-- Runs on the PRAGATI Season 1 squads inside one transaction and ROLLS BACK: nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/fixtures_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (k text, v bigint);
create temp table s as select 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8'::uuid as id;
delete from public.squad_matches where season_id = (select id from s);
update public.seasons set status = 'active', is_current = true where id = (select id from s);
update public.squads set archived_at = null where season_id = (select id from s);

-- 1. Week 7 (championship). League weeks 3-6 all played. The nightly job must add no league match.
update public.seasons set created_at = now() - interval '61 minutes' where id = (select id from s);
select public.generate_cohort_league((select id from s), true);
update public.squad_matches set status = 'played' where season_id = (select id from s);
select public.extend_all_fixtures();
insert into r select 'w7: league matches after week 6 (want 0)', count(*) from public.squad_matches
 where season_id = (select id from s) and stage = 'league' and round_number > 6;

-- 2. A hand rebuild from round 7 must not touch other stages and must not draw league after week 6.
insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage)
select (select id from s), 7, a.id, b.id, now(), 'scheduled', 'championship'
  from public.squads a, public.squads b where a.season_id = (select id from s) and b.season_id = a.season_id and a.name < b.name limit 1;
select public.generate_round_robin((select id from s), true, 7);
insert into r select 'rebuild: championship rows kept (want 1)', count(*) from public.squad_matches
 where season_id = (select id from s) and stage = 'championship';
insert into r select 'rebuild: league matches after week 6 (want 0)', count(*) from public.squad_matches
 where season_id = (select id from s) and stage = 'league' and round_number > 6;

-- 3. Week 4 (league). Round 3 played, a new squad joins section CSE-A: it gets weeks 4-6, same section only.
delete from public.squad_matches where season_id = (select id from s);
update public.seasons set created_at = now() - interval '31 minutes' where id = (select id from s);
select public.generate_cohort_league((select id from s), true);
update public.squad_matches set status = 'played' where season_id = (select id from s) and round_number = 3;
insert into r select 'w4: played round-3 rows before', count(*) from public.squad_matches where season_id = (select id from s) and status = 'played';
insert into public.squads (season_id, name, cohort) values ((select id from s), 'MF004 new squad', 'CSE-A');
select public.extend_all_fixtures();
insert into r select 'w4: played round-3 rows after (want same)', count(*) from public.squad_matches where season_id = (select id from s) and status = 'played';
insert into r select 'w4: new squad league matches (want > 0)', count(*) from public.squad_matches m
  join public.squads q on q.name = 'MF004 new squad' and q.season_id = m.season_id
 where m.season_id = (select id from s) and q.id in (m.home_squad, m.away_squad);
insert into r select 'w4: matches across sections (want 0)', count(*) from public.squad_matches m
  join public.squads h on h.id = m.home_squad join public.squads a on a.id = m.away_squad
 where m.season_id = (select id from s) and m.stage = 'league' and coalesce(h.cohort, '') <> coalesce(a.cohort, '');
insert into r select 'w4: league matches outside weeks 3-6 (want 0)', count(*) from public.squad_matches
 where season_id = (select id from s) and stage = 'league' and round_number not between 3 and 6;

select k as check, v as value from r;
rollback;
