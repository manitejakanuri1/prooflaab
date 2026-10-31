-- Rollback of 201: puts the old wording back from mf012_text_backup and re-adds tasks.upload_deadline (empty).
begin;
alter table public.tasks add column if not exists upload_deadline timestamptz;
update public.level_content lc set proof_brief = b.old_value
  from public.mf012_text_backup b where b.tbl = 'level_content' and b.col = 'proof_brief' and b.row_key = lc.level_id::text;
update public.tasks t set description = b.old_value
  from public.mf012_text_backup b where b.tbl = 'tasks' and b.col = 'description' and b.row_key = t.id::text;
insert into public.task_explainers (key, brief)
select row_key, old_value::jsonb from public.mf012_text_backup where tbl = 'task_explainers'
on conflict (key) do nothing;
notify pgrst, 'reload schema';
commit;
