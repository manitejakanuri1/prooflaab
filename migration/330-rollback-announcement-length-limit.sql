-- Rollback of 330.
alter table public.announcements drop constraint if exists announcements_text_length;
