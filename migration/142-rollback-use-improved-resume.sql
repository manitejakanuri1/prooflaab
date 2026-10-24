-- Rollback of 142. Resumes already switched keep the improved text and scores; the original_* columns keep
-- the old ones, so nothing is lost. Columns are kept (dropping them would lose that record).
begin;
drop function if exists public.use_improved_resume(uuid);
commit;
notify pgrst, 'reload schema';
