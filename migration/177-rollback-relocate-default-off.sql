-- Rollback of 177.
begin;
alter table public.student_profiles alter column open_to_relocate set default true;
commit;
