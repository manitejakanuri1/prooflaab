-- MF-009 check (TEST only): one win-draw-loss record per squad, counted from league matches only, the same in
-- the squads table (Home, Standings, student page, CSV) and in tpo_squad_achievements (Squads > history).
-- Recounts every season inside one transaction and ROLLS BACK: nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/standings_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
select public.recount_season(id) from public.seasons;
create temp table league as
select q.id, q.college_id, q.name, q.wins, q.draws, q.losses,
       (select count(*) from public.squad_matches x where x.status = 'played' and x.stage = 'league'
           and q.id in (x.home_squad, x.away_squad)) as league_played
  from public.squads q;
select set_config('request.jwt.claims', json_build_object('sub', c.user_id, 'role', 'authenticated')::text, true)
  from public.colleges c where c.name = 'PRAGATI';
create temp table ach as select * from public.tpo_squad_achievements();
select l.name, l.wins || '-' || l.draws || '-' || l.losses as squads_table,
       a.wins || '-' || a.draws || '-' || a.losses as history, l.league_played
  from league l join ach a on a.squad_id = l.id order by l.name;
select 'records that differ between screens (want 0)' as check, count(*) as value
  from league l join ach a on a.squad_id = l.id
 where (l.wins, l.draws, l.losses) is distinct from (a.wins::int, a.draws::int, a.losses::int)
union all
select 'impossible records: W+D+L <> league matches played (want 0)', count(*)
  from league where wins + draws + losses <> league_played;
rollback;
