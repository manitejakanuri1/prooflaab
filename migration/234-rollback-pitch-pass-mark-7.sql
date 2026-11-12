-- Rollback for 234: pitch configs back to their old pass mark; trigger removed.
begin;
drop trigger if exists pitch_pass_mark on public.lot_templates;
drop function if exists public.pitch_pass_mark();
update public.task_rubric_config c set pass_threshold = b.pass_threshold, updated_at = now()
  from public.backup_pitch_pass_20261112 b where b.id = c.id;
commit;
