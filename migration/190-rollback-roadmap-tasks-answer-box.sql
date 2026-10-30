-- Rollback of 190: put back the roadmap task text saved before the change. The backup table is kept (ask before deleting).
begin;
update public.tasks t set description = b.description
  from public.mf109_task_text_backup b where b.task_id = t.id;
commit;
