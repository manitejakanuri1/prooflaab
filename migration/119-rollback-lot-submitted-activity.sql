-- Rollback of 119: completed Lots stop writing 'lot_submitted' events.
begin;
drop trigger if exists tasks_lot_activity on public.tasks;
drop function if exists public.activity_from_lot();
commit;
