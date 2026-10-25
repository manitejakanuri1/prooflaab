-- 134: every portfolio has a share link.
--
-- WHY. Found on staging 23 Oct 2026: "Share Portfolio" always answered "Portfolio not ready". The page
-- builds the link from student_portfolios.slug, and slug had no default - 5 of 6 staging portfolios
-- (every one created by the page itself) had none, so no student could ever share.
-- NOW. slug defaults to 'p-' plus 12 random hex characters (not the student's name: a link should not be
-- guessable), every empty slug is filled, and slug becomes NOT NULL. Existing slugs are kept.
-- Rollback: migration/134-rollback-portfolio-slug-always-set.sql
begin;
alter table public.student_portfolios
  alter column slug set default ('p-' || substr(md5(gen_random_uuid()::text), 1, 12));
update public.student_portfolios set slug = 'p-' || substr(md5(gen_random_uuid()::text), 1, 12) where slug is null;
alter table public.student_portfolios alter column slug set not null;
do $$ begin
  if exists (select 1 from public.student_portfolios where slug is null) then raise exception '134: a portfolio still has no slug'; end if;
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'student_portfolios' and column_name = 'slug') is null then
    raise exception '134: no default on slug';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
