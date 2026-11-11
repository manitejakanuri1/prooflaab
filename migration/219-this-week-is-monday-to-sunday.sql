-- 219 (retest R3, 11 Nov 2026). TEST first; REAL only with the owner's yes.
--   The student "This week" (Daily Card, Progress) used the SEASON week (marks_week_window). A season can start on
--   any weekday and its weeks roll over at 00:00 UTC (05:30 IST), so on TEST (season weeks Wed-Tue) the card showed
--   "17.2 · 1 Lot" before 05:30 on Wednesday and "0 · 0 Lots" after it, while Tuesday's Lot is this week for the student.
--   my_marks_week now always uses the calendar week, Monday 00:00 to next Monday 00:00 India time. It also returns
--   season_to (end of the running season week) for the squad card's "next update" line.
--   Display only: squad scoring (run_squad_week / squad_marks_week / daily_marks) and the skip warning
--   (my_lot_state) keep the season week. No mark or point changes.
-- Rollback: migration/219-rollback-this-week-is-monday-to-sunday.sql
begin;

create or replace function public.my_marks_week()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  with w as (
    select (date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as from_at
  ), cw as (select from_at, from_at + interval '7 days' as to_at from w)
  select jsonb_build_object(
           'from', cw.from_at, 'to', cw.to_at,
           'season_to', (select sw.to_at from public.marks_week_window(auth.uid()) sw),
           'days', coalesce((select jsonb_agg(jsonb_build_object(
                      'task_id', lm.task_id, 'lot_at', lm.lot_at, 'coding_mark', lm.coding_mark,
                      'voice_mark', lm.voice_mark, 'voice_state', lm.voice_state, 'skip_no', lm.skip_no,
                      'day_total', lm.day_total) order by lm.lot_at)
                      from public.lot_marks(auth.uid(), cw.from_at, cw.to_at) lm), '[]'::jsonb),
           'week_total', coalesce((select sum(lm.day_total) from public.lot_marks(auth.uid(), cw.from_at, cw.to_at) lm), 0),
           'skips', (select count(*) from public.lot_marks(auth.uid(), cw.from_at, cw.to_at) lm where lm.voice_state = 'skip'))
    from cw;
$fn$;

do $$
begin
  if pg_get_functiondef('public.my_marks_week()'::regprocedure) !~ 'Asia/Kolkata' then
    raise exception '219: my_marks_week is not on the India calendar week';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
