-- 298 (owner E2E 12 Nov 2026, C9): a typed task (college / admin / company) had no length limit on the server, so a
-- 2000+ character description was accepted while the screen showed no limit. One limit now, on the table, so every
-- path obeys it (college direct insert, assign_tasks, templates): title up to 200 characters (same as assign_tasks
-- manual mode), description up to 4000. Daily Lots (written by the server from source pages) are not limited here.
-- Rollback: migration/298-rollback-task-text-length-limit.sql
begin;
alter table public.tasks drop constraint if exists tasks_typed_text_length;
alter table public.tasks add constraint tasks_typed_text_length check (
  source is not distinct from 'daily_lot'
  or (char_length(coalesce(title, '')) <= 200 and char_length(coalesce(description, '')) <= 4000)) not valid;
alter table public.tasks validate constraint tasks_typed_text_length;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_typed_text_length' and convalidated) then
    raise exception '298 self-check: constraint missing';
  end if;
end $$;
commit;
