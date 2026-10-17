-- 119: a completed Daily Lot counts for the squad.
--
-- Squad scoring (run_squad_week) counts student_activity_events, and the
-- "Lot submitted" rule (10 points) needs an event of type 'lot_submitted'.
-- The only writer of that event was the task_assignments trigger
-- (activity_from_assignment): assigned tasks. A Daily Lot is a tasks row with a
-- lot_date and never has an assignment (0 on staging), and record_task_submission
-- only calls record_activity (quests and streaks, not this log). So a passed Lot
-- never earned its 10 squad points. Found on staging, 17 Oct 2026: two passed
-- coding Lots (sim12.s2, sim12.s3) wrote no event; the voice recording did.
--
-- A trigger on tasks now logs 'lot_submitted' when a Lot (lot_date set) becomes
-- completed, the same way the assignment trigger does. Lots completed before
-- this migration are not backfilled.
begin;

create or replace function public.activity_from_lot()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = 'completed' and new.lot_date is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.log_activity(new.student_id, 'lot_submitted', 'tasks', new.id);
  end if;
  return new;
end $function$;

revoke all on function public.activity_from_lot() from public, anon, authenticated;

drop trigger if exists tasks_lot_activity on public.tasks;
create trigger tasks_lot_activity
  after insert or update of status on public.tasks
  for each row execute function public.activity_from_lot();

-- Self-check: completing a Lot writes exactly one event; nothing is kept.
do $$
declare sid uuid; tid uuid; n integer;
begin
  select t.student_id, t.id into sid, tid from public.tasks t
   where t.lot_date is not null and t.status <> 'completed' and t.student_id is not null limit 1;
  if tid is null then
    raise notice '119 self-check skipped: no open Lot to try';
    return;
  end if;
  update public.tasks set status = 'completed' where id = tid;
  select count(*) into n from public.student_activity_events
   where source_type = 'tasks' and source_id = tid and event_type = 'lot_submitted';
  if n <> 1 then raise exception '119 self-check: expected 1 lot_submitted event, got %', n; end if;
  raise exception 'self-check passed' using errcode = 'P0119';
exception when sqlstate 'P0119' then
  raise notice '119 self-check passed (test change rolled back)';
end $$;

commit;
