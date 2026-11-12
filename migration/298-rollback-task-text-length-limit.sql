-- Rollback of 298.
alter table public.tasks drop constraint if exists tasks_typed_text_length;
