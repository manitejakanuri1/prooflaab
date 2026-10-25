-- ROLLBACK for 134: slug optional again and no default. Filled slugs are kept (links already shared keep working).
begin;
alter table public.student_portfolios alter column slug drop not null;
alter table public.student_portfolios alter column slug drop default;
commit;
notify pgrst, 'reload schema';
