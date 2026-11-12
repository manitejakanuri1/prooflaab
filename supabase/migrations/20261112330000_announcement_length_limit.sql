-- 330 (owner E2E 12 Nov 2026, A4): an announcement accepted ~7,000 characters and a blank title. One limit on the
-- table so every path obeys it: title 1-150 characters (not blank), message up to 2000. Same numbers as the admin form.
-- Rollback: migration/330-rollback-announcement-length-limit.sql
begin;
alter table public.announcements drop constraint if exists announcements_text_length;
alter table public.announcements add constraint announcements_text_length check (
  char_length(btrim(title)) between 1 and 150
  and char_length(coalesce(description, '')) <= 2000) not valid;
alter table public.announcements validate constraint announcements_text_length;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'announcements_text_length' and convalidated) then
    raise exception '330 self-check: constraint missing';
  end if;
end $$;
commit;
