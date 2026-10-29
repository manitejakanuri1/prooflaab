-- MF-003 check (TEST only, owner rule 28 Oct 2026, graded marks from migration 165 / 29 Oct 2026): a Daily Lot scores
-- coding mark + voice mark; a Lot with no voice is a skip (the first two skips of a week keep the coding mark), and a
-- miss costs only that student. A match where neither squad did any
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

-- Student A: 8 of 10 tests + voice 70 in week 3. Student B (another squad): 10 of 10, no voice (skip 1).
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

set local app.system_write = 'on';
set local request.jwt.claims = '{"role":"service_role"}';
-- Only this check's work counts on those two Lots (rolled back at the end).
create temp table two as
select (select t2.id from public.tasks t2 where t2.student_id = (select a from who) and t2.source = 'daily_lot' order by t2.id limit 1) as ta,
       (select t2.id from public.tasks t2 where t2.student_id = (select b from who) and t2.source = 'daily_lot' order by t2.id limit 1) as tb;
delete from public.voice_explanations where task_id in ((select ta from two), (select tb from two));
delete from public.task_submissions where task_id in ((select ta from two), (select tb from two));
insert into public.task_submissions (task_id, student_id, sandbox_config_id, rubric_config_id, code, sandbox_score, passed_count, total_count, status, created_at)
select t.id, t.student_id, t.sandbox_config_id, case when t.sandbox_config_id is null then t.rubric_config_id end, 'x',
       case when t.student_id = (select a from who) then 80 else 100 end,
       case when t.sandbox_config_id is null then 0 when t.student_id = (select a from who) then 8 else 10 end,
       case when t.sandbox_config_id is null then 0 else 10 end, 'failed', now() - interval '16 minutes'
  from public.tasks t
 where t.id in ((select ta from two), (select tb from two));
insert into public.voice_explanations (student_id, task_id, storage_path, transcript_source)
select (select a from who), t.id, 'check/' || gen_random_uuid(), 'server'
  from public.tasks t where t.student_id = (select a from who) and t.source = 'daily_lot' order by t.id limit 1;
update public.voice_explanations set status = 'scored', communication_score = 70
 where student_id = (select a from who) and storage_path like 'check/%' and status = 'recorded';
select public.run_all_seasons();

insert into r select 'A (8/10 + voice 70) week-3 points (want 15)', coalesce((select points::text from public.student_weekly_scores
  where season_id = (select id from s) and week = 3 and student_id = (select a from who)), 'no row');
insert into r select 'B (10/10, no voice = skip 1 keeps coding) week-3 points (want 10)', coalesce((select points::text from public.student_weekly_scores
  where season_id = (select id from s) and week = 3 and student_id = (select b from who)), 'no row');
insert into r select 'other students with week-3 points (want 0)', count(*)::text from public.student_weekly_scores
 where season_id = (select id from s) and week = 3 and points > 0 and student_id not in ((select a from who), (select b from who));
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
