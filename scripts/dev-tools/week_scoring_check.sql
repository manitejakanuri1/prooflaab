-- MF-003 check (TEST only, owner rule 28 Oct 2026): a student scores for a Daily Lot only when the task AND the
-- voice part are both done; anything less is 0 for that student only. A match where neither squad did any
-- finished work is "No activity yet", not a played 0-0. A tied semi-final / final is won by the higher seed and
-- says so. The weekly job scores every past week that has no score yet.
-- Uses PRAGATI Season 1 inside one transaction and ROLLS BACK: nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/week_scoring_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (k text, v text);
create temp table s as select 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8'::uuid as id;
-- Season 1 running again, now in week 5 (a TEST week is 10 minutes), squads and members back, no scores yet.
update public.seasons set status = 'active', is_current = true, completed_at = null,
       created_at = now() - interval '41 minutes' where id = (select id from s);
update public.squads set archived_at = null where season_id = (select id from s);
update public.squad_members m set left_at = null from public.squads q
 where q.id = m.squad_id and q.season_id = (select id from s);
delete from public.student_weekly_scores where season_id = (select id from s);
delete from public.squad_weekly_scores where season_id = (select id from s);
delete from public.squad_matches where season_id = (select id from s);
select public.generate_cohort_league((select id from s), true);

-- Student A finished a Lot in full in week 3 (task + voice). Student B (another squad) only passed the task.
create temp table who as
select (select m.student_id from public.squad_members m join public.squads q on q.id = m.squad_id
         where q.season_id = (select id from s) and q.name = 'CSE-A Titans 1'
           and exists (select 1 from public.tasks t where t.student_id = m.student_id and t.source = 'daily_lot')
         order by m.student_id limit 1) as a,
       (select m.student_id from public.squad_members m join public.squads q on q.id = m.squad_id
         where q.season_id = (select id from s) and q.name = 'CSE-B Titans 1'
           and exists (select 1 from public.tasks t where t.student_id = m.student_id and t.source = 'daily_lot')
         order by m.student_id limit 1) as b;
update public.tasks set status = 'completed', completed_at = now() - interval '16 minutes'
 where id = (select t.id from public.tasks t where t.student_id = (select a from who) and t.source = 'daily_lot' order by t.id limit 1);
update public.tasks set status = 'pending_voice', completed_at = null
 where id = (select t.id from public.tasks t where t.student_id = (select b from who) and t.source = 'daily_lot' order by t.id limit 1);

select public.run_all_seasons();

insert into r select 'A (task + voice) week-3 points (want > 0)', coalesce((select points::text from public.student_weekly_scores
  where season_id = (select id from s) and week = 3 and student_id = (select a from who)), 'no row');
insert into r select 'B (task only) week-3 points (want 0)', coalesce((select points::text from public.student_weekly_scores
  where season_id = (select id from s) and week = 3 and student_id = (select b from who)), 'no row');
insert into r select 'other students with week-3 points (want 0)', count(*)::text from public.student_weekly_scores
 where season_id = (select id from s) and week = 3 and points > 0 and student_id <> (select a from who);
insert into r select 'weeks 1-4 scored (want 1,2,3,4)', string_agg(distinct week::text, ',' order by week::text)
  from public.squad_weekly_scores where season_id = (select id from s);
insert into r select 'week-3 match of A''s squad', m.status || ' ' || m.home_points || '-' || m.away_points
  from public.squad_matches m join public.squads q on q.id in (m.home_squad, m.away_squad)
 where m.season_id = (select id from s) and m.round_number = 3 and q.name = 'CSE-A Titans 1';
insert into r select 'week-3/4 matches with no finished work shown as played 0-0 (want 0)', count(*)::text
  from public.squad_matches where season_id = (select id from s) and round_number in (3, 4)
   and status = 'played' and coalesce(home_points, 0) = 0 and coalesce(away_points, 0) = 0;

-- A semi-final where neither squad did anything: the higher seed goes through and the match says so.
update public.squads set seed = case name when 'CSE-A Titans 1' then 1 when 'CSE-B Titans 1' then 2
                                          when 'CSE-A Titans 2' then 3 else 4 end
 where season_id = (select id from s);
insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage)
select (select id from s), 4, b.id, a.id, now(), 'scheduled', 'knockout'
  from public.squads a, public.squads b
 where a.season_id = (select id from s) and b.season_id = a.season_id and a.seed = 1 and b.seed = 4;
select public.settle_round((select id from s), 4);
insert into r select 'tied semi-final: winner is seed 1 (want true)',
       coalesce((select (to_jsonb(m) ->> 'winner_squad') = (select id::text from public.squads where season_id = (select id from s) and seed = 1)
                   and (to_jsonb(m) ->> 'decided_by') = 'higher_seed'
                   from public.squad_matches m where m.season_id = (select id from s) and m.stage = 'knockout')::text, 'false');

select k as check, v as value from r;
rollback;
