-- Graded daily marks check (TEST only, owner plan 29 Oct 2026). Replaces the flat 20 points per Lot.
--   coding mark = best check: tests passed / total x 10 (visible and hidden count the same), 1 decimal
--   written mark = best check: rubric score / 10
--   voice mark   = the good recording's score / 10
--   day          = coding + voice; voice failed twice for off-topic talk = coding + 0 ("tried")
--   no voice / too short = a skip: the first two skips of a week keep the coding mark, the third and later count 0
--   week = sum of days (rounded to a whole number for squad points); squad = sum of members
-- Builds its own Daily Lots for two PRAGATI students inside one transaction and ROLLS BACK: nothing is kept.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/daily_marks_check.sql   (needs migration 165)
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
set local app.system_write = 'on';
set local request.jwt.claims = '{"role":"service_role"}';
create temp table r (k text, v text);
create temp table cfg as
select (select id from public.task_sandbox_config limit 1) as sandbox, (select id from public.task_rubric_config limit 1) as rubric;
-- Two PRAGATI students who share a Season 1 squad (Season 1 runs again inside this transaction).
create temp table s as select 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8'::uuid as id;
update public.seasons set status = 'active', is_current = true, completed_at = null,
       created_at = now() - interval '41 minutes' where id = (select id from s);
update public.squads set archived_at = null where season_id = (select id from s);
update public.squad_members m set left_at = null from public.squads q
 where q.id = m.squad_id and q.season_id = (select id from s);
delete from public.student_weekly_scores where season_id = (select id from s);
delete from public.squad_weekly_scores where season_id = (select id from s);
create temp table who as
select (select m.student_id from public.squad_members m join public.squads q on q.id = m.squad_id
         where q.season_id = (select id from s) and q.name = 'CSE-A Titans 1' order by m.student_id limit 1) as a,
       (select m.student_id from public.squad_members m join public.squads q on q.id = m.squad_id
         where q.season_id = (select id from s) and q.name = 'CSE-A Titans 1' order by m.student_id offset 1 limit 1) as b;
-- A clean slate for both: their own Daily Lots are moved out of the way (rolled back at the end).
update public.tasks set source = 'check_hidden' where source = 'daily_lot' and student_id in ((select a from who), (select b from who));

-- One Daily Lot per call: _checks = passed counts out of _total (or rubric scores when _total is null).
create function pg_temp.lot(_student uuid, _at timestamptz, _checks int[], _total int) returns uuid language plpgsql as $f$
declare t uuid; c int; i int := 0;
begin
  insert into public.tasks (student_id, title, source, status, grading_type, sandbox_config_id, rubric_config_id, created_at, lot_date)
  values (_student, 'marks check', 'daily_lot', 'pending', case when _total is null then 'written' else 'coding' end,
          case when _total is null then null else (select sandbox from cfg) end,
          case when _total is null then (select rubric from cfg) else null end, _at, null)
  returning id into t;
  foreach c in array _checks loop
    i := i + 1;
    insert into public.task_submissions (task_id, student_id, sandbox_config_id, rubric_config_id, code, sandbox_score,
                                         passed_count, total_count, status, created_at)
    values (t, _student, case when _total is null then null else (select sandbox from cfg) end,
            case when _total is null then (select rubric from cfg) else null end, 'x',
            case when _total is null then c else c * 10 end, case when _total is null then 0 else c end, coalesce(_total, 0),
            case when _total is not null and c = _total then 'passed' else 'failed' end, _at + i * interval '1 minute');
  end loop;
  return t;
end $f$;
-- A recording for a Lot: _score = a good recording, or _fail = silence / too_few_words / off_topic.
create function pg_temp.voice(_task uuid, _score int, _fail text) returns void language plpgsql as $f$
declare v uuid; st uuid;
begin
  select student_id into st from public.tasks where id = _task;
  insert into public.voice_explanations (student_id, task_id, storage_path, transcript_source)
  values (st, _task, 'check/' || gen_random_uuid(), 'server') returning id into v;
  update public.voice_explanations
     set status = case when _score is null then 'failed' else 'scored' end,
         communication_score = _score,
         evaluation = case when _fail is null then '{}'::jsonb else jsonb_build_object('attempt_fail', _fail) end
   where id = v;
end $f$;

-- Week 1 window: two hours ago to one hour ago (already over).
create temp table w as select now() - interval '2 hours' as f, now() - interval '1 hour' as t;
create temp table lots (k text, id uuid);
-- a. 8 of 10 tests (5 visible + 5 hidden), voice 70
insert into lots select 'a', pg_temp.lot((select a from who), (select f from w) + interval '1 minute', array[8], 10);
select pg_temp.voice((select id from lots where k = 'a'), 70, null);
-- b. 9 of 10 (one hidden test fails), voice 60
insert into lots select 'b', pg_temp.lot((select a from who), (select f from w) + interval '5 minutes', array[9], 10);
select pg_temp.voice((select id from lots where k = 'b'), 60, null);
-- c. checks 6, 9, 7 -> best 9, voice 50
insert into lots select 'c', pg_temp.lot((select a from who), (select f from w) + interval '10 minutes', array[6, 9, 7], 10);
select pg_temp.voice((select id from lots where k = 'c'), 50, null);
-- d. written checks 60 then 80, voice 40
insert into lots select 'd', pg_temp.lot((select a from who), (select f from w) + interval '15 minutes', array[60, 80], null);
select pg_temp.voice((select id from lots where k = 'd'), 40, null);
-- f. off-topic twice -> tried: coding counts, voice 0
insert into lots select 'f', pg_temp.lot((select a from who), (select f from w) + interval '20 minutes', array[7], 10);
select pg_temp.voice((select id from lots where k = 'f'), null, 'off_topic');
select pg_temp.voice((select id from lots where k = 'f'), null, 'off_topic');
-- g. three skips: no voice, too short twice, no voice
insert into lots select 'g1', pg_temp.lot((select a from who), (select f from w) + interval '25 minutes', array[6], 10);
insert into lots select 'g2', pg_temp.lot((select a from who), (select f from w) + interval '30 minutes', array[5], 10);
select pg_temp.voice((select id from lots where k = 'g2'), null, 'too_few_words');
select pg_temp.voice((select id from lots where k = 'g2'), null, 'silence');
insert into lots select 'g3', pg_temp.lot((select a from who), (select f from w) + interval '35 minutes', array[10], 10);

create temp table m1 as select * from public.lot_marks((select a from who), (select f from w), (select t from w));
insert into r select 'a. 8/10 + voice 70 (want 8.0 7.0 15.0)', concat_ws(' ', coding_mark, voice_mark, day_total) from m1 where task_id = (select id from lots where k = 'a');
insert into r select 'b. 9/10, a hidden test failed (want coding 9.0)', coding_mark::text from m1 where task_id = (select id from lots where k = 'b');
insert into r select 'c. checks 6, 9, 7 (want coding 9.0)', coding_mark::text from m1 where task_id = (select id from lots where k = 'c');
insert into r select 'c. checks left after 3 (want 0)', public.lot_state((select a from who), (select id from lots where k = 'c')) ->> 'checks_left';
insert into r select 'd. written 60 then 80 (want coding 8.0)', coding_mark::text from m1 where task_id = (select id from lots where k = 'd');
insert into r select 'd. written checks left after 2 (want 0)', public.lot_state((select a from who), (select id from lots where k = 'd')) ->> 'checks_left';
insert into r select 'f. off-topic twice (want tried 7.0 0 7.0)', concat_ws(' ', voice_state, coding_mark, voice_mark, day_total) from m1 where task_id = (select id from lots where k = 'f');
insert into r select 'g. skip 1 keeps coding (want skip 1 6.0)', concat_ws(' ', voice_state, skip_no, day_total) from m1 where task_id = (select id from lots where k = 'g1');
insert into r select 'g. skip 2 (too short twice) keeps coding (want skip 2 5.0)', concat_ws(' ', voice_state, skip_no, day_total) from m1 where task_id = (select id from lots where k = 'g2');
insert into r select 'g. skip 3 counts 0 (want skip 3 0)', concat_ws(' ', voice_state, skip_no, day_total) from m1 where task_id = (select id from lots where k = 'g3');
insert into r select 'j. week = sum of days (want 15+15+14+12+7+6+5+0 = 74.0)', sum(day_total)::text from m1;

-- e. 0 tests passed, then Submit: voice opens (pending_voice), coding 0
insert into lots select 'e', pg_temp.lot((select a from who), now() - interval '3 minutes', array[0], 10);
insert into r select 'e. 0 passed, checks left (want 2)', public.lot_state((select a from who), (select id from lots where k = 'e')) ->> 'checks_left';
select public.lot_submit((select a from who), (select id from lots where k = 'e'));
insert into r select 'e. Submit with 0 passed (want pending_voice 0.0)',
       (select status from public.tasks where id = (select id from lots where k = 'e'))
       || ' ' || (public.lot_state((select a from who), (select id from lots where k = 'e')) ->> 'best_mark');
insert into r select 'e. check after Submit refused (want 0 checks left)', public.lot_state((select a from who), (select id from lots where k = 'e')) ->> 'checks_left';
-- Voice: one bad recording leaves one try, the second closes it.
select pg_temp.voice((select id from lots where k = 'e'), null, 'off_topic');
insert into r select 'voice: tries left after one off-topic (want 1)',
       public.lot_state((select a from who), (select id from lots where k = 'e')) ->> 'voice_tries_left';
select pg_temp.voice((select id from lots where k = 'e'), null, 'silence');
insert into r select 'voice: closed after two bad (want true tried)',
       concat_ws(' ', public.lot_state((select a from who), (select id from lots where k = 'e')) ->> 'voice_closed',
                      public.lot_state((select a from who), (select id from lots where k = 'e')) ->> 'voice_state');

-- h. next week starts fresh: a skip in the following window is skip number 1 again.
insert into lots select 'h', pg_temp.lot((select a from who), (select t from w) + interval '1 minute', array[4], 10);
insert into r select 'h. next week skip (want skip 1 4.0)', concat_ws(' ', voice_state, skip_no, day_total)
  from public.lot_marks((select a from who), (select t from w), (select t from w) + interval '50 minutes') where task_id = (select id from lots where k = 'h');

-- i. Squad week: A has marks in week 3, B (same squad) missed every day. Squad points = A's total only.
insert into lots select 'i', pg_temp.lot((select a from who), (select starts_at from public.season_week_bounds((select id from s), 3)) + interval '1 minute', array[8], 10);
select pg_temp.voice((select id from lots where k = 'i'), 70, null);
select public.run_squad_week((select id from s), 3);
insert into r select 'i. A week-3 points (want 15)', coalesce((select points::text from public.student_weekly_scores
  where season_id = (select id from s) and week = 3 and student_id = (select a from who)), 'no row');
insert into r select 'i. B missed (want 0)', coalesce((select points::text from public.student_weekly_scores
  where season_id = (select id from s) and week = 3 and student_id = (select b from who)), 'no row');
insert into r select 'i. squad week-3 points = A only (want 15)', w3.points::text from public.squad_weekly_scores w3 join public.squads q on q.id = w3.squad_id
 where w3.season_id = (select id from s) and w3.week = 3 and q.name = 'CSE-A Titans 1';
insert into r select 'i. daily marks saved for A (want 8.0 7.0 15.0)', concat_ws(' ', coding_mark, voice_mark, day_total)
  from public.daily_marks where task_id = (select id from lots where k = 'i');
insert into r select 'k. squads with no work in week 3 shown as played 0-0 (want 0)', count(*)::text from public.squad_matches
 where season_id = (select id from s) and round_number = 3 and status = 'played' and coalesce(home_points, 0) = 0 and coalesce(away_points, 0) = 0;

-- As student A, signed in (what the dashboard and squad page call). A Lot checked just now sits in the current week.
insert into lots select 'm', pg_temp.lot((select a from who), now(), array[8], 10);
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', (select a from who))::text, true);
insert into r select 'l. my_marks_week as A: the Lot checked just now listed (want true)',
       ((public.my_marks_week() -> 'days') @> jsonb_build_array(jsonb_build_object('task_id', (select id from lots where k = 'm'))))::text;
insert into r select 'l. squad_marks_week as A: members listed, A marked as me (want true)',
       (jsonb_array_length(public.squad_marks_week() -> 'members') > 1
        and exists (select 1 from jsonb_array_elements(public.squad_marks_week() -> 'members') m
                     where (m ->> 'is_me')::boolean and m ->> 'student_id' = (select a from who)::text))::text;
insert into r select 'l. squad_marks_week of another squad as A (want null)',
       coalesce(public.squad_marks_week((select q.id from public.squads q where q.season_id = (select id from s)
                                          and q.name <> 'CSE-A Titans 1' limit 1))::text, 'null');
insert into r select 'l. lot_submit from the browser (want refused)',
       case when has_function_privilege('authenticated', 'public.lot_submit(uuid,uuid)', 'execute') then 'OPEN' else 'refused' end;

select k as check, v as value from r order by k;
rollback;
