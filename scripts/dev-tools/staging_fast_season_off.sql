-- TEST WEBSITE ONLY: back to normal 7-day weeks for every season (migration 149 stays; it is a no-op when unset).
\set ON_ERROR_STOP on
begin;
delete from public.app_settings where key in ('season_week_minutes', 'season_fast_colleges');
commit;
