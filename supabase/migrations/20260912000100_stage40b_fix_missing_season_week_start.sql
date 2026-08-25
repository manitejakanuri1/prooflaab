-- run_squad_week (stage 32, and the version just replaced in stage 40) calls
-- public.season_week_start(_season_id, _week), which was never defined —
-- season_week_bounds exists, season_week_start does not. Every real call to
-- run_squad_week has been throwing since stage 32, which means
-- run_all_seasons() has been failing outright every time the Sunday cron
-- fired: it calls run_squad_week with no exception handler, so one missing
-- function aborted the whole weekly run, including generate_round_robin and
-- close_season in the same loop iteration.
--
-- Fix is to define the missing function rather than touch the two callers —
-- their logic (>= start, < start + 7 days) is already correct for whatever
-- season_week_start returns, which is exactly season_week_bounds().starts_at.
create function public.season_week_start(_season_id uuid, _week integer)
returns timestamptz
language sql stable set search_path = public, pg_temp
as $$
  select starts_at from public.season_week_bounds(_season_id, _week);
$$;
