-- Streak check (TEST only, migration 170): the streak moves only when today's Daily Lot is completed
-- (written/code AND voice). A mock interview, a scored voice or a topic clear alone does nothing. ROLLS BACK.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/streak_daily_lot_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (n int, what text, ok boolean);
do $$
declare
  sid uuid; lot uuid; today date := (now() at time zone 'Asia/Kolkata')::date; d int;
begin
  perform set_config('app.system_write', 'on', true);
  -- a student with a Daily Lot row we can reuse for today
  select t.student_id, t.id into sid, lot from public.tasks t where t.lot_date is not null and t.student_id is not null limit 1;
  delete from public.student_streaks where student_id = sid;
  update public.tasks set lot_date = null where student_id = sid and lot_date = today and id <> lot;
  update public.tasks set lot_date = today, status = 'pending_voice' where id = lot;

  perform public.touch_streak(sid);                        -- like a mock interview / scored voice / topic clear
  select coalesce(max(current_days), 0) into d from public.student_streaks where student_id = sid;
  insert into r values (1, 'Lot not finished: activity alone does not move the streak', d = 0);

  perform public.record_activity(sid, 'voice_recorded');   -- the voice / level-clear trigger path
  select coalesce(max(current_days), 0) into d from public.student_streaks where student_id = sid;
  insert into r values (2, 'Lot not finished: record_activity does not move it either', d = 0);

  update public.tasks set status = 'completed' where id = lot;   -- both parts done
  select coalesce(max(current_days), 0) into d from public.student_streaks where student_id = sid;
  insert into r values (3, 'Lot completed: streak = 1', d = 1);

  perform public.touch_streak(sid);
  select coalesce(max(current_days), 0) into d from public.student_streaks where student_id = sid;
  insert into r values (4, 'Second call the same day: still 1', d = 1);

  update public.student_streaks set current_days = 4, last_active_on = today - 1 where student_id = sid;
  perform public.touch_streak(sid);
  select current_days into d from public.student_streaks where student_id = sid;
  insert into r values (5, 'Yesterday counted: 4 becomes 5', d = 5);
end $$;
select n, what, case when ok then 'PASS' else 'FAIL' end as result from r order by n;
select count(*) filter (where ok) || ' of ' || count(*) || ' pass' as total from r;
rollback;
