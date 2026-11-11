-- TEST only. Puts back the task text saved by item20_reword_stdin_lots.sql (qa_backup.item20_text). Not run.
begin;
select set_config('app.system_write', 'on', true);
update public.tasks t set description = b.old_text from qa_backup.item20_text b where b.kind = 'task' and t.id = b.id;
update public.lot_templates lt set scenario = b.old_text from qa_backup.item20_text b where b.kind = 'template' and lt.id = b.id;
commit;
