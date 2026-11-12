-- 233 (Purna 12 Nov 2026, item 2): college Home "Tried a Lot today: 0" while the Students list showed today's tries.
--   tpo_home / tpo_insights compared submission times with current_date, which is the database's UTC date
--   (so "today" started at 05:30 IST). Like 171 and 230, they now run in India time; the Students list (230) already does.
-- Rollback: migration/233-rollback-college-today-india-date.sql
begin;
alter function public.tpo_home() set timezone to 'Asia/Kolkata';
alter function public.tpo_insights() set timezone to 'Asia/Kolkata';
do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tpo_home', 'tpo_insights')
              and not coalesce(proconfig, '{}') @> array['TimeZone=Asia/Kolkata']) then
    raise exception '233 self-check: a college count still uses the UTC date';
  end if;
end $$;
commit;
