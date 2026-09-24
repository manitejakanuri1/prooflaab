-- 40: notify_weekly_progress() had no guard against being run twice - a Cloud
-- Scheduler retry (or the job firing twice) within the same run would insert a
-- second identical "your week" notification for the same student/week. Every
-- other scheduled RPC in this system already guards against this (assign_todays_lots
-- checks for an existing row, extend_all_fixtures checks before generating,
-- plan_student_week deletes-then-inserts) - this one didn't. Confirmed by test in
-- staging: two calls with the same qualifying score row produced 2 notifications
-- instead of 1.
--
-- Fix: add one more condition to the function's own existing WHERE clause, using
-- the same 2-hour window it already checks elsewhere in this function - skip a
-- student who was already sent a weekly_progress notification in that window.
-- No business rule changes: a student who has NOT been notified in the last 2
-- hours gets notified exactly as before.
begin;

create or replace function public.notify_weekly_progress()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  insert into public.notifications (user_id, audience, source, type, title, message, link)
  select w.student_id, 'student', 'system', 'weekly_progress',
         case when prev.points is null or w.points >= prev.points
              then 'Your week: ' || w.points || ' points'
              else 'Your week: ' || w.points || ' points (down from ' || prev.points || ')' end,
         'Week ' || w.week || ': ' || w.points || ' points' ||
           case when prev.points is not null
                then ', ' || (case when w.points >= prev.points then '+' else '' end)
                     || (w.points - prev.points) || ' vs last week'
                else '' end ||
           '. Open your season report for where it came from.',
         '/student/dashboard'
    from public.student_weekly_scores w
    left join public.student_weekly_scores prev
      on prev.student_id = w.student_id and prev.season_id = w.season_id and prev.week = w.week - 1
   where w.week = (select max(w2.week) from public.student_weekly_scores w2 where w2.season_id = w.season_id)
     and w.computed_at >= now() - interval '2 hours'
     and w.points > 0
     and not exists (
       select 1 from public.notifications existing
        where existing.user_id = w.student_id
          and existing.type = 'weekly_progress'
          and existing.created_at >= now() - interval '2 hours'
     );
  get diagnostics n = row_count;
  return n;
end $function$;

commit;
notify pgrst, 'reload schema';
