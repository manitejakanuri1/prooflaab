-- Rollback 386: these functions go back to the database clock (UTC).
alter function public.season_week(uuid)                       reset timezone;
alter function public.season_week_bounds(uuid, integer)       reset timezone;
alter function public.run_all_seasons()                       reset timezone;
alter function public.ensure_season(uuid, integer)            reset timezone;
alter function public.assign_to_squad(uuid, uuid, date)       reset timezone;
alter function public.score_student_week(uuid, uuid, integer) reset timezone;
alter function public.record_activity(uuid, text)             reset timezone;
notify pgrst, 'reload schema';
