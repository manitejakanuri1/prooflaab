-- 40: notify_weekly_progress() had no guard against being run twice - a Cloud
-- Scheduler retry (or the job firing twice) within the same run would insert a
-- second identical "your week" notification for the same student/week. Every
-- other scheduled RPC in this system already guards against this (assign_todays_lots
-- checks for an existing row, extend_all_fixtures checks before generating,
-- plan_student_week deletes-then-inserts) - this one didn't. Confirmed by test in
-- staging: two calls with the same qualifying score row produced 2 notifications
-- instead of 1.
--
-- First fix (superseded below): a 2-hour time-window check. Replaced because a
-- time window is the wrong shape for this - it would also block a genuinely
-- different week's notification if it happened to fall within 2 hours of
-- another, and it would NOT block a duplicate if the same week's score was
-- recomputed hours later (exactly the case that matters: scoring reruns,
-- weekly_progress reruns, same week - a time window has already expired by
-- then and does nothing).
--
-- Durable fix: one weekly_progress notification per (student, season, week),
-- forever, regardless of when it's sent - a permanent business key, not a
-- clock. `notifications.dedupe_key` + a partial unique index on
-- (user_id, type, dedupe_key) enforces this at the database level, so even a
-- genuine race (two calls at the exact same instant) can't create two rows -
-- a NOT EXISTS check can lose that race, a unique index cannot. Other
-- notification types are untouched: the index only applies where a caller
-- sets dedupe_key, via the partial WHERE clause.
--
-- Deployment-safety fix (found in staging before this ever touched
-- production): a real production database already has weekly_progress
-- notifications sent before this column existed, with dedupe_key = NULL.
-- The unique index only catches a NEW row colliding with another row that
-- also HAS a dedupe_key - it does nothing against a legacy NULL row, since
-- NULL never equals NULL for uniqueness purposes. Reproduced in staging: a
-- legacy row for an already-notified week, then a first run of the fixed
-- function, produced a second notification for that same week. Fixed with
-- one extra guard that only matters during the rollout window: skip a week
-- that already has a legacy (dedupe_key is null) notification whose message
-- names that same week - the old message format always starts with
-- 'Week <n>:', which is exactly what a legacy row for that week looks like.
-- This guard is harmless once every week has a real dedupe_key; the unique
-- index remains the permanent mechanism for everything created from here on.
begin;

alter table public.notifications add column if not exists dedupe_key text;

create unique index if not exists notifications_user_type_dedupe_key_uniq
  on public.notifications (user_id, type, dedupe_key)
  where dedupe_key is not null;

create or replace function public.notify_weekly_progress()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  insert into public.notifications (user_id, audience, source, type, title, message, link, dedupe_key)
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
         '/student/dashboard',
         'weekly_progress:' || w.season_id || ':' || w.week
    from public.student_weekly_scores w
    left join public.student_weekly_scores prev
      on prev.student_id = w.student_id and prev.season_id = w.season_id and prev.week = w.week - 1
   where w.week = (select max(w2.week) from public.student_weekly_scores w2 where w2.season_id = w.season_id)
     and w.computed_at >= now() - interval '2 hours'
     and w.points > 0
     and not exists (
       select 1 from public.notifications legacy
        where legacy.user_id = w.student_id
          and legacy.type = 'weekly_progress'
          and legacy.dedupe_key is null
          and legacy.message like 'Week ' || w.week || ':%'
     )
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

commit;
notify pgrst, 'reload schema';
