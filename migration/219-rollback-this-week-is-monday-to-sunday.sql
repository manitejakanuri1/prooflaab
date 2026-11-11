-- Rollback of 219: my_marks_week back to the season week (migration 166).
begin;
create or replace function public.my_marks_week()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
           'from', w.from_at, 'to', w.to_at,
           'days', coalesce((select jsonb_agg(jsonb_build_object(
                      'task_id', lm.task_id, 'lot_at', lm.lot_at, 'coding_mark', lm.coding_mark,
                      'voice_mark', lm.voice_mark, 'voice_state', lm.voice_state, 'skip_no', lm.skip_no,
                      'day_total', lm.day_total) order by lm.lot_at)
                      from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm), '[]'::jsonb),
           'week_total', coalesce((select sum(lm.day_total) from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm), 0),
           'skips', (select count(*) from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm where lm.skip_no is not null))
    from public.marks_week_window(auth.uid()) w;
$fn$;
commit;
notify pgrst, 'reload schema';
