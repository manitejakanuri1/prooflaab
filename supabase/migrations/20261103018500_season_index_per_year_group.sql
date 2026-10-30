-- 185 (owner, 31 Oct 2026): follow-up to 184. The old rule "one running season per college"
-- (index seasons_one_current_per_college) is replaced by 184's "one running season per year group"
-- (seasons_one_current_per_year_group), so 2nd year and 3rd year can run side by side.
-- Rollback: migration/185-rollback-season-index-per-year-group.sql
begin;
drop index if exists public.seasons_one_current_per_college;
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'seasons_one_current_per_year_group') then
    raise exception '185: the per-year-group rule from 184 is missing';
  end if;
end $$;
commit;
