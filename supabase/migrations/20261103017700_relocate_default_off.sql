-- 177 (MF-080, 30 Oct 2026): "open to relocate" is off until the student says so. The column defaulted to true,
--   so every student looked willing to move to companies. Only the default changes; existing rows are left as
--   they are because a student may have chosen yes on purpose.
-- Rollback: migration/177-rollback-relocate-default-off.sql
begin;
alter table public.student_profiles alter column open_to_relocate set default false;
do $$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'student_profiles' and column_name = 'open_to_relocate') <> 'false' then
    raise exception '177: open_to_relocate still defaults to true';
  end if;
end $$;
commit;
