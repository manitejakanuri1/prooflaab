-- 386 (13 Nov 2026, owner + Purna): scoring and seasons count days in India time, not UTC.
-- The database clock is UTC, so current_date, ::date and date::timestamptz in these functions
-- changed day at 5:30 AM IST: a season week began at 5:30 AM, an "active day" or daily quest done
-- at 1 AM IST counted for the day before. Same fix the newer functions already use (my_week,
-- plan_student_week, admin_daily_lots): run the function with TimeZone = Asia/Kolkata.
-- No function body changes; the fast TEST season clock (10-minute weeks) is unaffected.
alter function public.season_week(uuid)                       set timezone = 'Asia/Kolkata';
alter function public.season_week_bounds(uuid, integer)       set timezone = 'Asia/Kolkata';
alter function public.run_all_seasons()                       set timezone = 'Asia/Kolkata';
alter function public.ensure_season(uuid, integer)            set timezone = 'Asia/Kolkata';
alter function public.assign_to_squad(uuid, uuid, date)       set timezone = 'Asia/Kolkata';
alter function public.score_student_week(uuid, uuid, integer) set timezone = 'Asia/Kolkata';
alter function public.record_activity(uuid, text)             set timezone = 'Asia/Kolkata';

do $$
declare missing text;
begin
  select string_agg(p.proname, ', ') into missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('season_week','season_week_bounds','run_all_seasons','ensure_season',
                       'assign_to_squad','score_student_week','record_activity')
     and not coalesce(array_to_string(p.proconfig, ',') ~* 'timezone=asia/kolkata', false);
  if missing is not null then raise exception '386 self-check: still UTC: %', missing; end if;
end $$;

notify pgrst, 'reload schema';
