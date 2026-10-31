-- Rollback of 191: put back the roadmap due dates saved before the change. The backup table is kept (ask before deleting).
begin;
update public.tasks t set due_date = b.due_date from public.mf076_due_date_backup b where b.task_id = t.id;
commit;
