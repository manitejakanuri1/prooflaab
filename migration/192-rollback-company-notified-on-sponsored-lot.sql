-- Rollback of 192: stop notifying companies. Notifications already sent stay (ask before deleting).
begin;
drop trigger if exists tasks_notify_company_done on public.tasks;
drop function if exists public.notify_company_sponsored_done();
commit;
