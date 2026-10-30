-- Rollback of 185: one running season per college again. Fails if a college has two year groups running.
begin;
create unique index if not exists seasons_one_current_per_college on public.seasons (college_id) where is_current;
commit;
